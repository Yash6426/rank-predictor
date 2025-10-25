// public/script.js
async function calculate() {
  console.log("Button clicked! Starting calculate...");
  const url = document.getElementById("urlInput").value.trim();
  const resultDiv = document.getElementById("result");
  resultDiv.innerHTML = "<strong>Calculating... (check console)</strong>";

  if (!url) {
    resultDiv.innerHTML = "⚠️ Please enter a valid URL.";
    console.log("No URL entered.");
    return;
  }
  console.log("URL captured:", url);

  try {
    console.log("Sending fetch to /api/parse...");
    const res = await fetch("/api/parse", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });
    console.log("Fetch complete. Status:", res.status);
    const data = await res.json();
    console.log("Response data:", data);

    if (!res.ok || data.error || !data.ok) {
      const errMsg =
        data.error || data.detail || "Server error (check server console)";
      resultDiv.innerHTML = `❌ Error: ${errMsg}<br><small>Tip: Use a response sheet URL with "Your Answer" text.</small>`;
    } else {
      // Check if section-wise data is available; fallback to old 'result' if not
      if (
        data.sections &&
        Array.isArray(data.sections) &&
        data.sections.length > 0
      ) {
        // New section-wise display
        let html = `<strong>Section-Wise Scores:</strong><br>
          <table border="1" style="border-collapse: collapse; margin: 10px auto; width: 100%; font-size: 14px;">
            <tr><th>Section</th><th>Correct</th><th>Wrong</th><th>Unattempted</th><th>Marks</th><th>Accuracy</th></tr>`;
        data.sections.forEach((sec) => {
          html += `<tr><td>${sec.name || "Unknown"}</td><td>${
            sec.correct
          }</td><td>${sec.wrong}</td><td>${sec.unattempted}</td><td><strong>${
            sec.totalMarks
          }</strong></td><td>${sec.accuracy}%</td></tr>`;
        });
        html += `</table><br><strong>Grand Total:</strong> ${data.total.totalQuestions} Questions | ${data.total.correct} Correct | ${data.total.wrong} Wrong | ${data.total.unattempted} Unattempted = <strong>${data.total.totalMarks} Marks</strong> (${data.total.accuracy}% Accuracy)`;
        if (data.estimatedRank) {
          html += `<br><strong>Estimated Rank:</strong> ${data.estimatedRank} (Percentile: ${data.percentile}%, based on ${data.sampleSize} samples)`;
        } else {
          html += `<br><small>No DB connected—add MONGO_URI for ranks.</small>`;
        }
        resultDiv.innerHTML = html;
      } else {
        // Fallback to old single-result display
        const rankInfo = data.estimatedRank
          ? `<br><strong>Est. Rank:</strong> ${data.estimatedRank} (percentile: ${data.percentile}%, samples: ${data.sampleSize})`
          : "<br><small>No DB—add MONGO_URI for ranks.</small>";
        resultDiv.innerHTML = `
          <strong>Success! Parsed ${data.parsedCount} answers:</strong><br>
          <strong>Total Qs:</strong> ${data.result.totalQuestions}<br>
          <strong>Correct:</strong> ${data.result.correct}<br>
          <strong>Wrong:</strong> ${data.result.wrong}<br>
          <strong>Unattempted:</strong> ${data.result.unattempted}<br>
          <strong>Marks:</strong> ${data.result.totalMarks} (accuracy: ${data.result.accuracy}%)<br>
          ${rankInfo}
        `;
      }
    }
  } catch (err) {
    console.error("Full fetch error:", err);
    resultDiv.innerHTML = `❌ Network error: ${err.message}<br><small>Open F12 Console for details. Try incognito?</small>`;
  }
}

// Auto-attach listener when page loads
document.addEventListener("DOMContentLoaded", () => {
  const btn = document.getElementById("calcBtn");
  if (btn) {
    btn.addEventListener("click", calculate);
    console.log("Event listener attached to button.");
  } else {
    console.error("Button not found! Check HTML ID.");
  }
});
