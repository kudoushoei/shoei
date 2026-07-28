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

// 種目を初めて設定するときの候補。設定画面で自由に追加・削除できる。
const DEFAULT_EXERCISES = [
  { id: "bench", name: "ベンチプレス" },
  { id: "squat", name: "スクワット" },
  { id: "deadlift", name: "デッドリフト" },
  { id: "shoulderPress", name: "ショルダープレス" },
  { id: "latPulldown", name: "ラットプルダウン" },
];

// 入力を楽にするための選択肢。重量・回数は5刻み、セット数は1刻み。
const WEIGHT_OPTIONS = Array.from({ length: 41 }, (_, i) => i * 5); // 0〜200kg
const REP_OPTIONS = Array.from({ length: 12 }, (_, i) => (i + 1) * 5); // 5〜60回
const SET_OPTIONS = Array.from({ length: 10 }, (_, i) => i + 1); // 1〜10セット

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
    exercises: null, // nullなら未設定。DEFAULT_EXERCISESを初期値として提示する
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

  // ---- workouts (筋トレ) ----
  function getExercises(settings) {
    return settings.exercises && settings.exercises.length ? settings.exercises : DEFAULT_EXERCISES;
  }
  async function saveExercises(exercises) {
    await saveSettings({ exercises });
  }
  async function getWorkoutForDate(date) {
    return (await DB.get("workouts", date)) || { date, entries: [] };
  }
  async function saveWorkout(date, entries) {
    await DB.put("workouts", { date, entries });
    // 採点で使う activity.trained を、その日の記録有無に合わせて同期する
    await upsertActivity(date, { trained: entries.length > 0 });
  }
  async function getWorkoutRange(days) {
    const dates = new Set(lastNDates(days));
    const all = await DB.getAll("workouts");
    return all.filter((r) => dates.has(r.date)).sort((a, b) => (a.date < b.date ? -1 : 1));
  }

  // 筋トレの消費カロリー概算。
  // ACSMのMET式 kcal/分 = MET × 3.5 × 体重kg / 200 をベースに、
  // 1セットあたり休憩込みで約2.5分・実効MET5.0(中〜高強度の筋トレ)として見積もる。
  function estimateWorkoutCalories(entries, bodyWeightKg) {
    const weight = bodyWeightKg || 65;
    const totalSets = (entries || []).reduce((sum, e) => sum + (Number(e.sets) || 0), 0);
    const kcalPerMin = (5.0 * 3.5 * weight) / 200;
    return Math.round(totalSets * 2.5 * kcalPerMin);
  }

  function workoutVolume(entries) {
    return (entries || []).reduce((sum, e) => sum + (Number(e.weightKg) || 0) * (Number(e.reps) || 0) * (Number(e.sets) || 0), 0);
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

  const STEP_GOAL = 8000;
  const SLEEP_GOAL_H = 7;

  // 100点満点、減点方式の厳しめ採点。よほど完璧な日でない限り100点にはならない。
  async function computeDailyScore(date) {
    const [settings, meals, activity] = await Promise.all([getSettings(), getMealsForDate(date), getActivityForDate(date)]);
    const totals = sumMeals(meals);

    if (meals.length === 0 && !activity.trained && activity.steps == null) {
      return { score: null, reasons: ["この日はまだ記録がありません"], hasData: false };
    }

    let score = 100;
    const reasons = [];

    function deduct(points, reason) {
      score -= points;
      reasons.push(reason);
    }

    // カロリー (最大15点。目標±3%以内でないと満点にならない)
    if (settings.targetCalories) {
      const diffPct = Math.round((Math.abs(totals.calories - settings.targetCalories) / settings.targetCalories) * 100);
      if (diffPct > 25) deduct(15, `カロリーが目標から${diffPct}%ズレています(${n0v(totals.calories)} / ${n0v(settings.targetCalories)} kcal)`);
      else if (diffPct > 15) deduct(11, `カロリーが目標から${diffPct}%ズレています`);
      else if (diffPct > 8) deduct(7, `カロリーが目標から${diffPct}%ズレています`);
      else if (diffPct > 3) deduct(3, `カロリーが目標から${diffPct}%ズレています`);
    }

    // タンパク質 (最大15点、目標の98%未満は必ず減点)
    if (settings.targetProteinG) {
      const pct = Math.round((totals.proteinG / settings.targetProteinG) * 100);
      if (pct < 60) deduct(15, `タンパク質が目標の${pct}%しか摂れていません`);
      else if (pct < 85) deduct(10, `タンパク質が目標の${pct}%にとどまっています`);
      else if (pct < 98) deduct(4, `タンパク質が目標にわずかに届いていません(${pct}%)`);
    }

    // 脂質・炭水化物 (最大10点。目標±10%を超えたら減点)
    let fatCarbDeduction = 0;
    if (settings.targetFatG) {
      const diffPct = Math.abs(totals.fatG - settings.targetFatG) / settings.targetFatG;
      if (diffPct > 0.25) fatCarbDeduction += 5;
      else if (diffPct > 0.1) fatCarbDeduction += 2;
    }
    if (settings.targetCarbG) {
      const diffPct = Math.abs(totals.carbG - settings.targetCarbG) / settings.targetCarbG;
      if (diffPct > 0.25) fatCarbDeduction += 5;
      else if (diffPct > 0.1) fatCarbDeduction += 2;
    }
    if (fatCarbDeduction > 0) deduct(fatCarbDeduction, "脂質・炭水化物のバランスが目標からズレています");

    // 選択中の微量栄養素の不足 (1項目につき7点、最大20点)
    const gaps = getDeficiencies(totals, settings).filter((g) => g.key !== "proteinG");
    if (gaps.length > 0) {
      deduct(Math.min(20, gaps.length * 7), `${gaps.map((g) => g.label).join("・")}が不足しています`);
    }

    // トレーニング (20点)
    if (!activity.trained) {
      deduct(20, "筋トレの記録がありません（筋トレタブから記録できます）");
    }

    // 歩数 (10点、データが無ければ対象外。目標未達なら満点にならない)
    if (activity.steps != null) {
      const pct = Math.round((activity.steps / STEP_GOAL) * 100);
      if (pct < 40) deduct(10, `歩数が少なめです(${n0v(activity.steps)}歩)`);
      else if (pct < 75) deduct(6, `歩数が目標(${STEP_GOAL.toLocaleString()}歩)にやや届いていません`);
      else if (pct < 100) deduct(2, `歩数が目標にわずかに届いていません(${n0v(activity.steps)}歩)`);
    }

    // 睡眠 (10点、データが無ければ対象外。7時間未満は必ず減点)
    if (activity.sleepHours != null && activity.sleepHours > 0) {
      if (activity.sleepHours < 5) deduct(10, `睡眠時間が${activity.sleepHours}時間と短めです`);
      else if (activity.sleepHours < 6) deduct(6, `睡眠時間が不足しています(${activity.sleepHours}時間)`);
      else if (activity.sleepHours < SLEEP_GOAL_H) deduct(2, `睡眠時間が目標にわずかに届いていません(${activity.sleepHours}時間)`);
    }

    score = Math.max(0, Math.round(score));
    if (reasons.length === 0) reasons.push("大きな穴は見当たりません。この調子で");
    return { score, reasons, hasData: true };
  }
  function n0v(v) {
    return Math.round(v).toLocaleString();
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
    getExercises,
    saveExercises,
    getWorkoutForDate,
    saveWorkout,
    getWorkoutRange,
    estimateWorkoutCalories,
    workoutVolume,
    addMeal,
    deleteMeal,
    getMealsForDate,
    sumMeals,
    getDeficiencies,
    computeDailyScore,
  };
})();
