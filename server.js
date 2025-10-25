// server.js
import express from "express";
import helmet from "helmet";
import cors from "cors";
import dotenv from "dotenv";
import axios from "axios";
import mongoose from "mongoose";
import { RateLimiterMemory } from "rate-limiter-flexible";
import path from "path";
import { fileURLToPath } from "url";
import Score from "./models/Score.js";
import { parseAnswers, computeSectionScores } from "./parser.js"; // Updated import

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        ...helmet.contentSecurityPolicy.getDefaultDirectives(),
        "script-src-elem": ["'self'", "'unsafe-inline'", "'unsafe-eval'"], // Added 'unsafe-eval' for any JS needs
        "style-src": ["'self'", "'unsafe-inline'"],
      },
    },
  })
);
app.use(cors());
app.use(express.json({ limit: "3mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI || "";
const TRUSTED_HOSTS = (process.env.TRUSTED_HOSTS || "cdn.digialm.com")
  .split(",")
  .map((s) => s.trim());

// Rate limiter setup
const rateLimiter = new RateLimiterMemory({
  points: 40,
  duration: 60,
});

// Rate limit middleware
const rateLimitMiddleware = async (req, res, next) => {
  const ip = req.ip || req.headers["x-forwarded-for"] || "unknown";
  try {
    await rateLimiter.consume(ip);
    next();
  } catch (e) {
    res.status(429).json({ ok: false, error: "Too many requests" });
  }
};
app.use(rateLimitMiddleware); // Apply globally

// Connect to DB
if (MONGO_URI) {
  mongoose
    .connect(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
    .then(() => console.log("MongoDB connected"))
    .catch((e) => console.error("MongoDB connect error:", e.message));
} else {
  console.warn(
    "No MONGO_URI configured. DB features disabled (rank estimation won't persist)."
  );
}

// Helper: Server-side fetch
async function fetchUrl(url) {
  const maxSize = Number(process.env.MAX_FETCH_SIZE || 2_500_000); // bytes
  const res = await axios.get(url, {
    responseType: "text",
    maxContentLength: maxSize,
    timeout: 10_000,
    headers: { "User-Agent": "MarksRankBot/1.0 (+https://yourdomain.example)" },
    validateStatus: (s) => s >= 200 && s < 400,
  });
  return res.data;
}

// Endpoint: Parse from URL or HTML
app.post("/api/parse", async (req, res) => {
  const {
    url,
    html,
    marksPerCorrect = 1,
    negativePerWrong = 0.25,
    save = true,
    totalCandidates = 300000,
  } = req.body || {};
  if (!url && !html)
    return res
      .status(400)
      .json({ ok: false, error: "Provide 'url' or 'html'" });

  let pageHtml = html || "";
  if (url) {
    try {
      const parsedUrl = new URL(url);
      const hostname = parsedUrl.hostname;
      if (!TRUSTED_HOSTS.includes(hostname) && TRUSTED_HOSTS[0] !== "*") {
        console.warn("Fetching from untrusted host:", hostname);
      }
      pageHtml = await fetchUrl(url);
    } catch (err) {
      return res.status(500).json({
        ok: false,
        error: "Failed to fetch URL. If protected, paste HTML instead.",
        detail: err.message,
      });
    }
  }

  // Parse & compute (updated for sections)
  const parsedData = parseAnswers(pageHtml); // Returns { sections: [...] }
  const { sections } = parsedData;
  if (sections.length === 0 || sections.every((s) => s.pairs.length === 0)) {
    return res.status(422).json({
      ok: false,
      error: "No answer pairs detected. Try pasting full HTML source.",
    });
  }

  const scores = computeSectionScores(sections); // New: Section-wise + total

  // Save score if DB present (updated for sections)
  let saved = null;
  try {
    if (mongoose.connection.readyState === 1 && save) {
      const doc = new Score({
        sourceUrl: url || null,
        totalMarks: scores.total.totalMarks,
        totalQuestions: scores.total.totalQuestions,
        correct: scores.total.correct,
        wrong: scores.total.wrong,
        unattempted: scores.total.unattempted,
        marksPerCorrect: Number(marksPerCorrect),
        negativePerWrong: Number(negativePerWrong),
        sections: sections.map((sec) => ({
          // Save sections
          name: sec.name,
          pairs: sec.pairs, // Or summarize to save space
          correct: sec.correct, // Pre-compute if needed
          wrong: sec.wrong,
          unattempted: sec.unattempted,
          totalMarks: sec.totalMarks,
        })),
      });
      saved = await doc.save();
    }
  } catch (e) {
    console.error("DB save error:", e.message);
  }

  // Rank estimation (based on totalMarks)
  let percentile = null,
    estimatedRank = null,
    sampleSize = 0;
  try {
    if (mongoose.connection.readyState === 1) {
      sampleSize = await Score.countDocuments();
      if (sampleSize > 0) {
        const less = await Score.countDocuments({
          totalMarks: { $lt: scores.total.totalMarks },
        });
        percentile = (less / sampleSize) * 100;
        estimatedRank = Math.max(
          1,
          Math.round((1 - percentile / 100) * Number(totalCandidates))
        );
      }
    }
  } catch (e) {
    console.error("Rank calc error:", e.message);
  }

  return res.json({
    ok: true,
    parsedCount: sections.flatMap((s) => s.pairs).length, // Total pairs
    pairsSample: sections.flatMap((s) => s.pairs).slice(0, 200),
    sections: scores.sections, // New: Array of { name, correct, wrong, ..., totalMarks }
    total: scores.total, // Grand total
    dbSaved: !!saved,
    percentile: percentile === null ? null : Math.round(percentile * 100) / 100,
    estimatedRank,
    sampleSize,
  });
});

// Root route: Serve UI
app.get("/", (req, res) => {
  const filePath = path.join(__dirname, "public", "ui.html");
  res.sendFile(filePath, (err) => {
    if (err) {
      res.status(404).send("UI not found—check public/ui.html");
    }
  });
});

app.listen(PORT, () =>
  console.log(`Server running on http://localhost:${PORT}`)
);
