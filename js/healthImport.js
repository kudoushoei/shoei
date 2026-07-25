// Apple ヘルスケアの「すべての健康データを書き出す」で得られる export.xml を
// ブラウザ上でチャンク読み込みしてパースする。DOMParserで全体を読み込むと
// 数十万レコードでタブが固まる/落ちるため、正規表現でRecordの開始タグだけを
// 逐次抜き出す軽量パーサーにしている。

const HealthImport = (() => {
  const CHUNK_SIZE = 8 * 1024 * 1024; // 8MB
  const RECORD_RE = /<Record\b[^>]*>/g;
  const ATTR_RE = /([\w:-]+)="([^"]*)"/g;

  function parseAttrs(tag) {
    const attrs = {};
    let m;
    ATTR_RE.lastIndex = 0;
    while ((m = ATTR_RE.exec(tag))) {
      attrs[m[1]] = m[2].replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
    }
    return attrs;
  }

  function dateOnly(healthDateStr) {
    // 例: "2026-07-20 08:15:00 +0900" -> "2026-07-20"
    return (healthDateStr || "").slice(0, 10);
  }

  function toKcal(value, unit) {
    const v = parseFloat(value);
    if (unit === "kJ") return v / 4.184;
    return v;
  }
  function toKg(value, unit) {
    const v = parseFloat(value);
    if (unit === "lb") return v * 0.45359237;
    if (unit === "st") return v * 6.35029;
    return v;
  }
  function toPercent(value) {
    const v = parseFloat(value);
    return v <= 1 ? v * 100 : v;
  }

  const SLEEP_ASLEEP_VALUES = new Set([
    "HKCategoryValueSleepAnalysisAsleep",
    "HKCategoryValueSleepAnalysisAsleepCore",
    "HKCategoryValueSleepAnalysisAsleepDeep",
    "HKCategoryValueSleepAnalysisAsleepREM",
    "HKCategoryValueSleepAnalysisAsleepUnspecified",
  ]);

  /**
   * @param {File} file
   * @param {(ratio:number)=>void} onProgress 0..1
   * @returns {Promise<{byDate: Map<string, object>, counts: object, dateMin: string, dateMax: string}>}
   */
  async function parseFile(file, onProgress) {
    const byDate = new Map();
    const counts = { bodyMass: 0, bodyFat: 0, leanMass: 0, steps: 0, activeEnergy: 0, sleep: 0, heartRate: 0, other: 0 };
    let dateMin = null;
    let dateMax = null;

    function day(dateStr) {
      if (!byDate.has(dateStr)) {
        byDate.set(dateStr, {
          date: dateStr,
          steps: 0,
          activeEnergyKcal: 0,
          basalEnergyKcal: 0,
          sleepHours: 0,
          heartRateSum: 0,
          heartRateCount: 0,
          weightKg: null,
          weightAt: null,
          bodyFatPct: null,
          bodyFatAt: null,
          leanMassKg: null,
          leanMassAt: null,
        });
      }
      if (!dateMin || dateStr < dateMin) dateMin = dateStr;
      if (!dateMax || dateStr > dateMax) dateMax = dateStr;
      return byDate.get(dateStr);
    }

    function handleTag(tag) {
      const a = parseAttrs(tag);
      const type = a.type;
      if (!type || !a.startDate) return;
      const d = dateOnly(a.startDate);
      if (!d) return;

      switch (type) {
        case "HKQuantityTypeIdentifierBodyMass": {
          const rec = day(d);
          const kg = toKg(a.value, a.unit);
          if (!rec.weightAt || a.startDate > rec.weightAt) {
            rec.weightKg = Math.round(kg * 10) / 10;
            rec.weightAt = a.startDate;
          }
          counts.bodyMass++;
          break;
        }
        case "HKQuantityTypeIdentifierBodyFatPercentage": {
          const rec = day(d);
          const pct = toPercent(a.value);
          if (!rec.bodyFatAt || a.startDate > rec.bodyFatAt) {
            rec.bodyFatPct = Math.round(pct * 10) / 10;
            rec.bodyFatAt = a.startDate;
          }
          counts.bodyFat++;
          break;
        }
        case "HKQuantityTypeIdentifierLeanBodyMass": {
          const rec = day(d);
          const kg = toKg(a.value, a.unit);
          if (!rec.leanMassAt || a.startDate > rec.leanMassAt) {
            rec.leanMassKg = Math.round(kg * 10) / 10;
            rec.leanMassAt = a.startDate;
          }
          counts.leanMass++;
          break;
        }
        case "HKQuantityTypeIdentifierStepCount": {
          const rec = day(d);
          rec.steps += parseFloat(a.value) || 0;
          counts.steps++;
          break;
        }
        case "HKQuantityTypeIdentifierActiveEnergyBurned": {
          const rec = day(d);
          rec.activeEnergyKcal += toKcal(a.value, a.unit) || 0;
          counts.activeEnergy++;
          break;
        }
        case "HKQuantityTypeIdentifierBasalEnergyBurned": {
          const rec = day(d);
          rec.basalEnergyKcal += toKcal(a.value, a.unit) || 0;
          break;
        }
        case "HKQuantityTypeIdentifierHeartRate": {
          const rec = day(d);
          rec.heartRateSum += parseFloat(a.value) || 0;
          rec.heartRateCount += 1;
          counts.heartRate++;
          break;
        }
        case "HKCategoryTypeIdentifierSleepAnalysis": {
          if (!SLEEP_ASLEEP_VALUES.has(a.value)) break;
          if (!a.endDate) break;
          const start = new Date(a.startDate);
          const end = new Date(a.endDate);
          const hours = (end - start) / 3600000;
          if (hours > 0 && hours < 24) {
            const rec = day(d);
            rec.sleepHours += hours;
            counts.sleep++;
          }
          break;
        }
        default:
          break;
      }
    }

    let offset = 0;
    let leftover = "";
    while (offset < file.size) {
      const slice = file.slice(offset, offset + CHUNK_SIZE);
      const chunkText = await slice.text();
      offset += CHUNK_SIZE;
      const text = leftover + chunkText;

      RECORD_RE.lastIndex = 0;
      let match;
      let lastIndex = 0;
      while ((match = RECORD_RE.exec(text))) {
        handleTag(match[0]);
        lastIndex = RECORD_RE.lastIndex;
      }
      // 末尾に不完全なタグが残っている可能性があるので次のチャンクへ持ち越す
      const tail = text.slice(Math.max(lastIndex, text.length - 4096));
      leftover = tail;

      if (onProgress) onProgress(Math.min(offset / file.size, 1));
      // メインスレッドを固めないよう一呼吸
      await new Promise((r) => setTimeout(r, 0));
    }

    // 睡眠は日をまたぐ場合があるので24hを超えないよう軽くクリップ
    for (const rec of byDate.values()) {
      if (rec.sleepHours > 24) rec.sleepHours = 24;
      rec.heartRateAvg = rec.heartRateCount ? Math.round(rec.heartRateSum / rec.heartRateCount) : null;
    }

    return { byDate, counts, dateMin, dateMax };
  }

  async function saveToDb(parsed) {
    const bodyRows = [];
    const activityRows = [];
    for (const rec of parsed.byDate.values()) {
      if (rec.weightKg != null || rec.bodyFatPct != null || rec.leanMassKg != null) {
        const existing = await DB.get("bodyMetrics", rec.date);
        bodyRows.push({
          date: rec.date,
          weightKg: rec.weightKg ?? existing?.weightKg ?? null,
          bodyFatPct: rec.bodyFatPct ?? existing?.bodyFatPct ?? null,
          leanMassKg: rec.leanMassKg ?? existing?.leanMassKg ?? null,
        });
      }
      activityRows.push({
        date: rec.date,
        steps: Math.round(rec.steps),
        activeEnergyKcal: Math.round(rec.activeEnergyKcal),
        basalEnergyKcal: Math.round(rec.basalEnergyKcal),
        sleepHours: Math.round(rec.sleepHours * 10) / 10,
        heartRateAvg: rec.heartRateAvg,
      });
    }
    if (bodyRows.length) await DB.putMany("bodyMetrics", bodyRows);
    if (activityRows.length) await DB.putMany("activity", activityRows);
    await Store.saveSettings({ lastImportAt: new Date().toISOString(), lastImportRange: [parsed.dateMin, parsed.dateMax] });
  }

  return { parseFile, saveToDb };
})();
