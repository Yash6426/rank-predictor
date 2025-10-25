// parser.js
import { load } from "cheerio";

/**
 * parseAnswers(html) - Extracts pairs and groups by section using .section-lbl structure
 * Returns { sections: [{ name: string, pairs: [{ your: string, correct: string }] }] }
 * 'Overall' is not included as a section; it's computed as total in computeSectionScores
 */
export function parseAnswers(html) {
  if (!html || typeof html !== "string") {
    console.warn("No valid HTML provided for parsing");
    return { sections: [] };
  }

  const $ = load(html);
  const sections = [];
  let currentSection = null; // No initial section

  // Detect sections: Loop over .section-lbl divs
  $(".section-lbl").each((i, lblDiv) => {
    const lblSpans = $(lblDiv).find("span");
    if (lblSpans.length >= 2) {
      const sectionPrefix = lblSpans.eq(0).text().trim(); // "Section :"
      const sectionName = lblSpans.eq(1).text().trim(); // "Current Affairs" (bold)
      if (sectionPrefix.includes("Section") && sectionName) {
        // New section
        currentSection = { name: sectionName, pairs: [] };
        sections.push(currentSection);
        console.log(`New section detected: ${sectionName}`);
      }
    }
  });

  // If no sections detected, create a single "Overall" but don't push to sections array
  if (sections.length === 0) {
    currentSection = { name: "Overall", pairs: [] };
    // Don't push to sections; total will handle it
  }

  // Collect all pairs
  const allPairs = [];
  $("table.norm-tbl, table.questionRowTbl").each((i, tbl) => {
    const tblElem = $(tbl);

    // Find Q.n row
    const qRows = tblElem.find("tr td").filter((j, td) =>
      $(td)
        .text()
        .trim()
        .match(/^Q\.\d+$/)
    );
    if (qRows.length === 0) return;
    const qTd = qRows.first();
    const qTr = qTd.parent("tr");
    if (!qTr.length) return;

    // Find Ans row
    let ansTr = qTr
      .next("tr")
      .filter((j, tr) => $(tr).find("td").text().includes("Ans"));
    if (ansTr.length === 0) {
      ansTr = qTr
        .nextAll("tr:has(td.bold)")
        .filter((j, tr) => $(tr).find("td").text().includes("Ans"))
        .first();
    }
    if (ansTr.length === 0) return;

    // Get 4 option rows
    const optionRows = [ansTr];
    let currentTr = ansTr;
    for (let k = 1; k < 4; k++) {
      currentTr = currentTr.next("tr");
      if (currentTr.length > 0) {
        optionRows.push(currentTr);
      } else {
        break;
      }
    }

    // Extract correct
    let correctNum = null;
    optionRows.forEach((optTr) => {
      const optTd = optTr.find("td").eq(1);
      if (
        optTd.hasClass("rightAns") ||
        optTd.find('img[src*="tick.png"]').length > 0
      ) {
        const optText = optTd.text().trim();
        const numMatch = optText.match(/^(\d+)\./);
        if (numMatch) {
          correctNum = numMatch[1];
          return false; // Found it
        }
      }
    });

    if (!correctNum) return;

    // Extract chosen from menu-tbl
    let menuTbl =
      tblElem.next("table.menu-tbl") ||
      tblElem.siblings("table.menu-tbl").first() ||
      tblElem.parent().next("table.menu-tbl");
    let chosenNum = null;
    if (menuTbl.length > 0) {
      const rows = menuTbl.find("tr");
      const chosenRow = rows.last();
      const tds = chosenRow.find("td");
      if (tds.length >= 2 && tds.eq(0).text().includes("Chosen Option")) {
        chosenNum = tds.eq(1).text().trim();
      }
    }

    // Define variables here to avoid scope issues
    const yourOpt = chosenNum ? mapToLetter(chosenNum) : "--";
    const correctOpt = mapToLetter(correctNum);
    const pair = { your: yourOpt, correct: correctOpt };

    // Add to allPairs
    allPairs.push(pair);

    // Assign to currentSection if exists
    if (currentSection) {
      currentSection.pairs.push(pair);
    }
  });

  // Even distribution: Assign pairs to sections proportionally
  if (sections.length > 1) {
    const numSections = sections.length;
    const pairsPerSection = Math.floor(allPairs.length / numSections);
    let idx = 0;
    sections.forEach((sec) => {
      const endIdx = idx + pairsPerSection;
      sec.pairs = allPairs.slice(idx, endIdx);
      idx = endIdx;
    });
    // Last section gets remainder
    sections[sections.length - 1].pairs = sections[
      sections.length - 1
    ].pairs.concat(allPairs.slice(idx));
  } else {
    // Single section (Overall)
    sections[0].pairs = allPairs;
  }

  // Fallback regex if no pairs
  if (sections.flatMap((s) => s.pairs).length === 0) {
    const bodyText = $("body").text().replace(/\s+/g, " ");
    const rx1 =
      /Your\s*Answer\s*[:\-]?\s*([A-D]|--|Not Attempted)\b.*?Correct\s*Answer\s*[:\-]?\s*([A-D])/gi;
    let m;
    while ((m = rx1.exec(bodyText)) !== null) {
      sections[sections.length - 1].pairs.push({ your: m[1], correct: m[2] });
    }
    // Add other patterns as needed
  }

  console.log(
    `Detected ${sections.length} sections: ${sections
      .map((s) => `${s.name}: ${s.pairs.length} pairs`)
      .join(", ")}`
  );
  return { sections };
}

function mapToLetter(num) {
  const map = { 1: "A", 2: "B", 3: "C", 4: "D" };
  return map[num] || "--";
}

export function computeSectionScores(sections) {
  const sectionResults = sections.map((sec) => {
    const sc = computeScore(sec.pairs);
    return { name: sec.name, ...sc };
  });

  const allPairs = sections.flatMap((sec) => sec.pairs);
  const totalSc = computeScore(allPairs);

  return { sections: sectionResults, total: totalSc };
}

export function computeScore(
  pairs = [],
  marksPerCorrect = 1,
  negativePerWrong = 0.25
) {
  let correct = 0,
    wrong = 0,
    unattempted = 0;
  pairs.forEach((p) => {
    const your = String(p.your || "")
      .trim()
      .toUpperCase();
    const correctOpt = String(p.correct || "")
      .trim()
      .toUpperCase();
    if (!your || your === "--" || /NOT\s*ATTEMPTED/i.test(your)) unattempted++;
    else if (your === correctOpt) correct++;
    else wrong++;
  });
  const totalMarks = correct * marksPerCorrect - wrong * negativePerWrong;
  const totalQuestions = correct + wrong + unattempted || pairs.length;
  const accuracy =
    totalQuestions === 0 ? 0 : (correct / Math.max(1, correct + wrong)) * 100;
  return {
    correct,
    wrong,
    unattempted,
    totalQuestions,
    marksPerCorrect,
    negativePerWrong,
    totalMarks: Math.round(totalMarks * 100) / 100,
    accuracy: Math.round(accuracy * 100) / 100,
  };
}
