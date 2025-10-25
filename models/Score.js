// models/Score.js
import mongoose from "mongoose";

const ScoreSchema = new mongoose.Schema({
  sourceUrl: { type: String, default: null },
  parsedAt: { type: Date, default: Date.now },
  totalMarks: { type: Number, required: true },
  totalQuestions: { type: Number, default: 0 },
  correct: { type: Number, default: 0 },
  wrong: { type: Number, default: 0 },
  unattempted: { type: Number, default: 0 },
  marksPerCorrect: { type: Number, default: 1 },
  negativePerWrong: { type: Number, default: 0.25 },
  meta: { type: Object, default: {} },
});

export default mongoose.model("Score", ScoreSchema);
