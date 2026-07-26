// 基本4項目(カロリー/P/F/C)に加えて、ユーザーが任意で追跡できる栄養素のカタログ。
// defaultTargetは成人の目安値（一般的な栄養摂取基準を参考にしたおおよその値）で、設定画面で調整できる。
// direction: "min" = 目標値以上を目指す(下回ると不足)、"max" = 目標値以下に抑えたい(超えると注意)
const NUTRIENT_CATALOG = [
  { key: "fiberG", label: "食物繊維", unit: "g", defaultTarget: 20, direction: "min" },
  { key: "sugarG", label: "糖質(糖類)", unit: "g", defaultTarget: 50, direction: "max" },
  { key: "sodiumMg", label: "ナトリウム(塩分相当)", unit: "mg", defaultTarget: 2000, direction: "max" },
  { key: "calciumMg", label: "カルシウム", unit: "mg", defaultTarget: 650, direction: "min" },
  { key: "ironMg", label: "鉄分", unit: "mg", defaultTarget: 7.5, direction: "min" },
  { key: "potassiumMg", label: "カリウム", unit: "mg", defaultTarget: 2500, direction: "min" },
  { key: "vitaminCMg", label: "ビタミンC", unit: "mg", defaultTarget: 100, direction: "min" },
];

const MEAL_TYPES = [
  { key: "breakfast", label: "朝食" },
  { key: "lunch", label: "昼食" },
  { key: "dinner", label: "夕食" },
  { key: "snack", label: "間食" },
];

function defaultMealTypeForNow() {
  const h = new Date().getHours();
  if (h < 10) return "breakfast";
  if (h < 15) return "lunch";
  if (h < 21) return "dinner";
  return "snack";
}

// 画面から使う高レベルAPI。日付は常に "YYYY-MM-DD" のローカル日付文字列で扱う。
const Store = (() => {
  function todayStr() {
    return toDateStr(new Date());
  }
  function toDateStr(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }
  function addDays(dateStr, n) {
    const d = new Date(dateStr + "T00:00:00");
    d.setDate(d.getDate() + n);
    return toDateStr(d);
  }
  function lastNDates(n, endDateStr) {
    const end = endDateStr || todayStr();
    const arr = [];
    for (let i = n - 1; i >= 0; i--) arr.push(addDays(end, -i));
    return arr;
  }

  const DEFAULT_SETTINGS = {
    heightCm: null,
    age: null,
    sex: "male",
    activityLevel: "moderate",
    goalType: "maintain",
    targetWeightKg: null,
    useAutoTargets: true,
    targetCalories: 2200,
    targetProteinG: 120,
    targetFatG: 60,
    targetCarbG: 250,
    geminiApiKey: "",
    selectedNutrients: [],
    extraTargets: {},
  };

  async function getSettings() {
    const rows = await DB.getAll("settings");
    const obj = { ...DEFAULT_SETTINGS };
    rows.forEach((r) => (obj[r.key] = r.value));
    return obj;
  }

  async function saveSettings(patch) {
    const entries = Object.entries(patch);
    for (const [key, value] of entries) {
      await DB.put("settings", { key, value });
    }
  }

  const ACTIVITY_FACTORS = {
    sedentary: 1.2,
    light: 1.375,
    moderate: 1.55,
    active: 1.725,
    veryActive: 1.9,
  };
  const GOAL_ADJUST = { cut: -500, maintain: 0, bulk: 300 };

  async function computeAutoTargets(settings, currentWeightKg) {
    const weight = currentWeightKg || settings.targetWeightKg || 65;
    if (!settings.heightCm || !settings.age) return null;
    const bmr =
      settings.sex === "female"
        ? 10 * weight + 6.25 * settings.heightCm - 5 * settings.age - 161
        : 10 * weight + 6.25 * settings.heightCm - 5 * settings.age + 5;
    const tdee = bmr * (ACTIVITY_FACTORS[settings.activityLevel] || 1.55);
    const calories = Math.round(tdee + (GOAL_ADJUST[settings.goalType] ?? 0));
    const proteinG = Math.round(weight * 2.0);
    const fatG = Math.round((calories * 0.25) / 9);
    const carbG = Math.round((calories - proteinG * 4 - fatG * 9) / 4);
    return { tdee: Math.round(tdee), calories, proteinG, fatG, carbG: Math.max(carbG, 0) };
  }

  // プロフィール(性別・年齢・摂取カロリー)から各栄養素の目標値を概算する。
  // 日本人の食事摂取基準・WHO推奨等を参考にしたおおよその値であり、厳密な個別診断ではない。
  function computeNutrientTargets(settings, calories) {
    const cal = calories || settings.targetCalories || 2200;
    const isFemale = settings.sex === "female";
    const age = settings.age || 30;
    const premenopausal = isFemale && age < 50;
    return {
      fiberG: Math.round((cal / 1000) * 14), // 目安: 1000kcalあたり14g
      sugarG: Math.round((cal * 0.1) / 4), // 目安: エネルギーの10%以内(WHO)
      sodiumMg: isFemale ? 2600 : 2950, // 塩分相当 女性6.5g/男性7.5g未満に相当
      calciumMg: isFemale ? 650 : 800,
      ironMg: premenopausal ? 10.5 : isFemale ? 6.5 : 7.5,
      potassiumMg: isFemale ? 2600 : 3000,
      vitaminCMg: 100,
    };
  }

  // ---- body metrics ----
  async function upsertBodyMetric(date, patch) {
    const existing = (await DB.get("bodyMetrics", date)) || { date };
    await DB.put("bodyMetrics", { ...existing, ...patch });
  }
  async function getBodyMetricsRange(days) {
    const dates = new Set(lastNDates(days));
    const all = await DB.getAll("bodyMetrics");
    return all.filter((r) => dates.has(r.date)).sort((a, b) => (a.date < b.date ? -1 : 1));
  }
  async function getLatestBodyMetric() {
    const all = await DB.getAll("bodyMetrics");
    const withWeight = all.filter((r) => r.weightKg != null).sort((a, b) => (a.date < b.date ? 1 : -1));
    return withWeight[0] || null;
  }

  // ---- activity ----
  async function upsertActivity(date, patch) {
    const existing = (await DB.get("activity", date)) || { date };
    await DB.put("activity", { ...existing, ...patch });
  }
  async function getActivityRange(days) {
    const dates = new Set(lastNDates(days));
    const all = await DB.getAll("activity");
    return all.filter((r) => dates.has(r.date)).sort((a, b) => (a.date < b.date ? -1 : 1));
  }
  async function getActivityForDate(date) {
    return (await DB.get("activity", date)) || { date };
  }

  // ---- meals ----
  async function addMeal(meal) {
    return DB.put("meals", meal);
  }
  async function deleteMeal(id) {
    return DB.delete("meals", id);
  }
  async function getMealsForDate(date) {
    const range = IDBKeyRange.only(date);
    const rows = await DB.getAllByIndex("meals", "byDate", range);
    return rows.sort((a, b) => (a.time || "").localeCompare(b.time || ""));
  }
  function sumMeals(meals) {
    const base = { calories: 0, proteinG: 0, fatG: 0, carbG: 0 };
    NUTRIENT_CATALOG.forEach((n) => (base[n.key] = 0));
    return meals.reduce((acc, m) => {
      acc.calories += Number(m.calories) || 0;
      acc.proteinG += Number(m.proteinG) || 0;
      acc.fatG += Number(m.fatG) || 0;
      acc.carbG += Number(m.carbG) || 0;
      NUTRIENT_CATALOG.forEach((n) => {
        acc[n.key] += Number(m[n.key]) || 0;
      });
      return acc;
    }, base);
  }

  // 目標に対して不足している項目(タンパク質+選択中のmin方向の栄養素)を返す。AI提案の材料にする。
  function getDeficiencies(totals, settings) {
    const gaps = [];
    if (settings.targetProteinG && totals.proteinG < settings.targetProteinG) {
      gaps.push({ key: "proteinG", label: "タンパク質", unit: "g", remaining: Math.round(settings.targetProteinG - totals.proteinG) });
    }
    NUTRIENT_CATALOG.filter((n) => n.direction === "min" && (settings.selectedNutrients || []).includes(n.key)).forEach((n) => {
      const target = settings.extraTargets?.[n.key] ?? n.defaultTarget;
      if (totals[n.key] < target) {
        gaps.push({ key: n.key, label: n.label, unit: n.unit, remaining: Math.round((target - totals[n.key]) * 10) / 10 });
      }
    });
    return gaps;
  }

  return {
    todayStr,
    toDateStr,
    addDays,
    lastNDates,
    getSettings,
    saveSettings,
    computeAutoTargets,
    computeNutrientTargets,
    upsertBodyMetric,
    getBodyMetricsRange,
    getLatestBodyMetric,
    upsertActivity,
    getActivityRange,
    getActivityForDate,
    addMeal,
    deleteMeal,
    getMealsForDate,
    sumMeals,
    getDeficiencies,
  };
})();
