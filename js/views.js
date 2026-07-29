const Views = {};

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}
function fmtDateShort(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  const w = ["日", "月", "火", "水", "木", "金", "土"][d.getDay()];
  return `${d.getMonth() + 1}/${d.getDate()}(${w})`;
}
function n0(v) {
  return v == null ? "--" : Math.round(v).toLocaleString();
}
function n1(v) {
  return v == null ? "--" : (Math.round(v * 10) / 10).toString();
}
function daysSince(isoStr) {
  const ms = Date.now() - new Date(isoStr).getTime();
  return Math.floor(ms / 86400000);
}

// ===================== ダッシュボード =====================
Views.dashboard = {
  title: "ダッシュボード",
  async render(root) {
    const today = Store.todayStr();
    const [bodyRows, activityRows, latest, settings, dailyScore, todayWorkout] = await Promise.all([
      Store.getBodyMetricsRange(14),
      Store.getActivityRange(7),
      Store.getLatestBodyMetric(),
      Store.getSettings(),
      Store.computeDailyScore(today),
      Store.getWorkoutForDate(today),
    ]);
    const todayActivity = activityRows.find((r) => r.date === today) || {};
    const meals = await Store.getMealsForDate(today);
    const totals = Store.sumMeals(meals);

    const withWeight = bodyRows.filter((r) => r.weightKg != null);
    let deltaHtml = "";
    if (withWeight.length >= 2) {
      const diff = withWeight[withWeight.length - 1].weightKg - withWeight[0].weightKg;
      const sign = diff > 0 ? "+" : "";
      const color = diff > 0 ? "var(--warning)" : diff < 0 ? "var(--accent)" : "var(--text-secondary)";
      deltaHtml = `<span style="font-size:13px; color:${color}">${sign}${n1(diff)} kg <span style="color:var(--text-muted)">(${withWeight.length}件の記録)</span></span>`;
    }

    const stepsSeries = Store.lastNDates(7).map((d) => ({
      label: fmtDateShort(d),
      value: activityRows.find((r) => r.date === d)?.steps ?? null,
    }));
    const sleepSeries = Store.lastNDates(7).map((d) => ({
      label: fmtDateShort(d),
      value: activityRows.find((r) => r.date === d)?.sleepHours ?? null,
    }));

    const scoreDates = Store.lastNDates(14);
    const scoreHistory = await Promise.all(scoreDates.map((d) => Store.computeDailyScore(d)));
    const scoreSeries = scoreDates.map((d, i) => ({
      label: fmtDateShort(d),
      value: scoreHistory[i].hasData ? scoreHistory[i].score : null,
    }));

    const calTarget = settings.targetCalories;
    const calPct = calTarget ? Math.min(100, Math.round((totals.calories / calTarget) * 100)) : 0;

    // ヘルスケアの活動カロリーには筋トレ分が含まれていない場合があるため、
    // 手動記録したワークアウトの推定消費を足して収支を出す
    const workoutBurn = Store.estimateWorkoutCalories(todayWorkout.entries, latest?.weightKg);
    const burned = (todayActivity.activeEnergyKcal || 0) + (todayActivity.basalEnergyKcal || 0) + workoutBurn;
    const hasBurnData = todayActivity.activeEnergyKcal != null && todayActivity.activeEnergyKcal > 0;
    const netBalance = totals.calories - burned;
    const goalLabel = { cut: "減量", maintain: "維持", bulk: "増量" }[settings.goalType] || "";

    let importTag;
    if (!settings.lastImportAt) {
      importTag = `<span class="tag warning">ヘルスケア未取込</span>`;
    } else {
      const d = daysSince(settings.lastImportAt);
      const label = d <= 0 ? "今日取込済み" : `最終取込: ${d}日前`;
      importTag = `<span class="tag ${d >= 3 ? "warning" : ""}">${label}</span>`;
    }

    root.innerHTML = `
      <div class="card card-hero">
        <div class="card-title">${Icons.sparkle}今日の採点</div>
        ${
          dailyScore.hasData
            ? `
          <div class="ring-row">
            <div class="ring-gauge">${Charts.scoreRing(dailyScore.score)}</div>
            <ul class="ring-reasons">
              ${dailyScore.reasons.map((r) => `<li>${escapeHtml(r)}</li>`).join("")}
            </ul>
          </div>`
            : `<div class="helptext-hero">${escapeHtml(dailyScore.reasons[0])}</div>`
        }
      </div>

      <div class="card" id="import-jump" style="cursor:pointer;">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <span class="card-title" style="margin:0;">ヘルスケアデータ</span>
          ${importTag}
        </div>
        <div class="helptext">タップして設定タブの取込へ（export.zipをそのまま選べます。展開もPCへの転送も不要です）</div>
      </div>

      <div class="card">
        <div class="card-title">${iconBadge("scale")}体重</div>
        <div style="display:flex; align-items:baseline; gap:10px; flex-wrap:wrap;">
          <span style="font-size:32px; font-weight:700; letter-spacing:-0.02em;">${latest ? n1(latest.weightKg) : "--"}<span style="font-size:14px;font-weight:500;color:var(--text-secondary)"> kg</span></span>
          ${deltaHtml}
        </div>
        ${latest ? `<div class="helptext">最終記録: ${escapeHtml(fmtDateShort(latest.date))}</div>` : `<div class="helptext">設定タブからヘルスケアデータを読み込むか、「体組成」タブで手入力できます</div>`}
      </div>

      <div class="stat-grid">
        <div class="stat-tile">${iconBadge("activity")}<div class="label">歩数</div><div class="value">${n0(todayActivity.steps)}<span class="unit">歩</span></div></div>
        <div class="stat-tile">${iconBadge("flame", "warning")}<div class="label">消費カロリー</div><div class="value">${n0(todayActivity.activeEnergyKcal)}<span class="unit">kcal</span></div></div>
        <div class="stat-tile">${iconBadge("moon", "neutral")}<div class="label">睡眠</div><div class="value">${n1(todayActivity.sleepHours)}<span class="unit">h</span></div></div>
        <div class="stat-tile">${iconBadge("utensils")}<div class="label">摂取カロリー</div><div class="value">${n0(totals.calories)}<span class="unit">kcal</span></div></div>
      </div>

      <div class="card">
        <div class="card-title">${Icons.trend}カロリー収支（目安）</div>
        <div style="font-size:28px; font-weight:700; letter-spacing:-0.02em; color:${netBalance <= 0 ? "var(--accent)" : "var(--warning)"};">
          ${netBalance > 0 ? "+" : ""}${n0(netBalance)}<span style="font-size:13px; font-weight:500; color:var(--text-secondary)"> kcal</span>
        </div>
        <div class="helptext">
          摂取 ${n0(totals.calories)} − 消費 ${n0(burned)} kcal${workoutBurn > 0 ? `（うち筋トレ ${n0(workoutBurn)}）` : ""}${goalLabel ? `　目標: ${goalLabel}` : ""}
          ${hasBurnData ? "" : "<br>※消費データが少ないようです。設定タブからヘルスケアを取込むと歩数・消費カロリーが反映されます"}
        </div>
      </div>

      <div class="card" id="diet-jump" style="margin-top:12px; cursor:pointer;">
        <div class="card-title">今日の食事 (目標 ${n0(calTarget)} kcal)</div>
        <div class="progress-bar ${calPct >= 100 && totals.calories > calTarget ? "over" : ""}"><div style="width:${calPct}%"></div></div>
        <div class="helptext">P ${n0(totals.proteinG)}g ・ F ${n0(totals.fatG)}g ・ C ${n0(totals.carbG)}g　タップして記録する</div>
      </div>

      <div class="section-title">採点の推移</div>
      <div class="card"><div class="card-title">${Icons.sparkle}直近14日</div><div class="chart-wrap">${Charts.lineChart(scoreSeries, { unit: "点" })}</div></div>

      <div class="section-title">直近7日の活動</div>
      <div class="card"><div class="card-title">${iconBadge("activity")}歩数</div><div class="chart-wrap">${Charts.lineChart(stepsSeries, { unit: "歩" })}</div></div>
      <div class="card"><div class="card-title">${iconBadge("moon", "neutral")}睡眠時間</div><div class="chart-wrap">${Charts.lineChart(sleepSeries, { unit: "h" })}</div></div>
    `;

    root.querySelector("#diet-jump").addEventListener("click", () => App.showView("diet"));
    root.querySelector("#import-jump").addEventListener("click", () => App.showView("settings"));
  },
};

// ===================== 体組成 =====================
let bodyRangeDays = 30;
Views.body = {
  title: "体組成",
  async render(root) {
    const settings = await Store.getSettings();
    const rows = await Store.getBodyMetricsRange(bodyRangeDays);
    const byDate = new Map(rows.map((r) => [r.date, r]));
    const dates = Store.lastNDates(bodyRangeDays);
    const step = bodyRangeDays > 60 ? Math.ceil(bodyRangeDays / 60) : 1;
    const sampled = dates.filter((_, i) => i % step === 0 || i === dates.length - 1);

    const weightSeries = sampled.map((d) => ({ label: fmtDateShort(d), value: byDate.get(d)?.weightKg ?? null }));
    const fatSeries = sampled.map((d) => ({ label: fmtDateShort(d), value: byDate.get(d)?.bodyFatPct ?? null }));
    const leanSeries = sampled.map((d) => ({ label: fmtDateShort(d), value: byDate.get(d)?.leanMassKg ?? null }));
    const hasLean = leanSeries.some((p) => p.value != null);

    const ranges = [
      [14, "2週間"],
      [30, "1ヶ月"],
      [90, "3ヶ月"],
      [365, "1年"],
    ];

    root.innerHTML = `
      <div class="segmented">
        ${ranges.map(([d, label]) => `<button data-days="${d}" class="${d === bodyRangeDays ? "active" : ""}">${label}</button>`).join("")}
      </div>

      <div class="section-title">体重</div>
      <div class="card"><div class="chart-wrap">${Charts.lineChart(weightSeries, { unit: "kg", target: settings.targetWeightKg })}</div></div>

      <div class="section-title">体脂肪率</div>
      <div class="card"><div class="chart-wrap">${Charts.lineChart(fatSeries, { unit: "%", color: "var(--warning, #854f0b)" })}</div></div>

      ${
        hasLean
          ? `<div class="section-title">除脂肪量</div><div class="card"><div class="chart-wrap">${Charts.lineChart(leanSeries, { unit: "kg", color: "#378add" })}</div></div>`
          : ""
      }

      <div class="section-title">記録を追加</div>
      <div class="card">
        <form id="body-form">
          <div class="field">
            <label>日付</label>
            <input type="date" name="date" value="${Store.todayStr()}" max="${Store.todayStr()}" required>
          </div>
          <div class="field-row">
            <div class="field"><label>体重 (kg)</label><input type="number" step="0.1" name="weightKg" placeholder="65.0"></div>
            <div class="field"><label>体脂肪率 (%)</label><input type="number" step="0.1" name="bodyFatPct" placeholder="18.0"></div>
          </div>
          <div class="field"><label>除脂肪量 (kg・任意)</label><input type="number" step="0.1" name="leanMassKg" placeholder=""></div>
          <button class="btn btn-primary" type="submit">保存</button>
        </form>
      </div>

      <div class="section-title">最近の記録</div>
      <div class="card" id="body-list">
        ${
          rows.length === 0
            ? `<div class="empty-state">記録がありません</div>`
            : [...rows]
                .reverse()
                .slice(0, 10)
                .map(
                  (r) => `
          <div class="list-item" data-date="${r.date}">
            <div>
              <div class="name">${escapeHtml(fmtDateShort(r.date))}</div>
              <div class="meta">${r.weightKg != null ? n1(r.weightKg) + " kg" : ""}${r.bodyFatPct != null ? " ・ " + n1(r.bodyFatPct) + " %" : ""}</div>
            </div>
            <button class="del-btn" data-del="${r.date}" aria-label="削除">×</button>
          </div>`
                )
                .join("")
        }
      </div>
    `;

    root.querySelectorAll(".segmented button").forEach((btn) => {
      btn.addEventListener("click", () => {
        bodyRangeDays = Number(btn.dataset.days);
        Views.body.render(root);
      });
    });

    root.querySelector("#body-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const date = fd.get("date");
      const weightKg = fd.get("weightKg") ? parseFloat(fd.get("weightKg")) : null;
      const bodyFatPct = fd.get("bodyFatPct") ? parseFloat(fd.get("bodyFatPct")) : null;
      const leanMassKg = fd.get("leanMassKg") ? parseFloat(fd.get("leanMassKg")) : null;
      const patch = {};
      if (weightKg != null) patch.weightKg = weightKg;
      if (bodyFatPct != null) patch.bodyFatPct = bodyFatPct;
      if (leanMassKg != null) patch.leanMassKg = leanMassKg;
      await Store.upsertBodyMetric(date, patch);
      App.toast("保存しました");
      Views.body.render(root);
    });

    root.querySelectorAll("[data-del]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        await DB.delete("bodyMetrics", btn.dataset.del);
        Views.body.render(root);
      });
    });
  },
};

// ===================== 食事 =====================
let dietDate = null;
let mealFormType = null;
Views.diet = {
  title: "食事",
  async render(root) {
    if (!dietDate) dietDate = Store.todayStr();
    if (!mealFormType) mealFormType = defaultMealTypeForNow();
    const [settings, meals] = await Promise.all([Store.getSettings(), Store.getMealsForDate(dietDate)]);
    const totals = Store.sumMeals(meals);
    const isToday = dietDate === Store.todayStr();

    const selectedExtra = NUTRIENT_CATALOG.filter((n) => (settings.selectedNutrients || []).includes(n.key));

    function row(label, value, target, unit, direction = "max") {
      const pct = target ? Math.min(100, Math.round((value / target) * 100)) : 0;
      const over = direction === "max" && target && value > target;
      const deficient = direction === "min" && target && value < target;
      return `
        <div style="margin-bottom:10px;">
          <div style="display:flex; justify-content:space-between; font-size:13px;">
            <span style="color:var(--text-secondary)">${label}</span>
            <span>${n0(value)} / ${target ? n0(target) : "--"} ${unit}${deficient ? '<span class="tag warning" style="margin-left:6px;">不足</span>' : ""}</span>
          </div>
          <div class="progress-bar ${over ? "over" : ""}"><div style="width:${pct}%"></div></div>
        </div>`;
    }

    const mealsByType = {};
    MEAL_TYPES.forEach((t) => (mealsByType[t.key] = []));
    meals.forEach((m) => {
      const t = mealsByType[m.mealType] ? m.mealType : "snack";
      mealsByType[t].push(m);
    });

    function mealItemHtml(m) {
      return `
        <div class="list-item">
          <div>
            <div class="name">${escapeHtml(m.name)}</div>
            <div class="meta">${m.time || ""} ・ P${n0(m.proteinG)} F${n0(m.fatG)} C${n0(m.carbG)}</div>
          </div>
          <div style="display:flex; align-items:center;">
            <span class="amount">${n0(m.calories)} kcal</span>
            <button class="del-btn" data-del="${m.id}" aria-label="削除">×</button>
          </div>
        </div>`;
    }

    root.innerHTML = `
      <div class="date-nav">
        <button id="prev-date">‹</button>
        <div class="date-label">${escapeHtml(fmtDateShort(dietDate))}${isToday ? " ・ 今日" : ""}</div>
        <button id="next-date" ${isToday ? "disabled style='opacity:.3'" : ""}>›</button>
      </div>

      <div class="card">
        <div class="card-title">${iconBadge("utensils")}摂取まとめ</div>
        ${row("カロリー", totals.calories, settings.targetCalories, "kcal")}
        ${row("タンパク質", totals.proteinG, settings.targetProteinG, "g")}
        ${row("脂質", totals.fatG, settings.targetFatG, "g")}
        ${row("炭水化物", totals.carbG, settings.targetCarbG, "g")}
        ${selectedExtra.map((n) => row(n.label, totals[n.key], settings.extraTargets?.[n.key] ?? n.defaultTarget, n.unit, n.direction)).join("")}
        <button class="btn" id="suggest-btn" style="margin-top:6px;">不足を補う食品を提案してもらう</button>
        <div id="suggest-result"></div>
      </div>

      <div class="section-title">写真から記録</div>
      <div class="card">
        <label class="btn btn-primary" style="display:flex; align-items:center; justify-content:center; gap:8px;">
          <span style="width:18px; height:18px; display:inline-flex;">${Icons.camera}</span>写真を撮る/選んでAIに解析させる
          <input type="file" id="photo-input" accept="image/*" style="display:none;">
        </label>
        <div id="photo-status" class="helptext" style="margin-top:8px; display:none;"></div>
      </div>

      <div class="section-title">記録を追加</div>
      <div class="card">
        <form id="meal-form">
          <div class="field">
            <label>食事の種類</label>
            <div class="segmented" id="mealtype-segmented">
              ${MEAL_TYPES.map((t) => `<button type="button" data-type="${t.key}" class="${t.key === mealFormType ? "active" : ""}">${t.label}</button>`).join("")}
            </div>
          </div>
          <div class="field"><label>食品名</label><input type="text" name="name" placeholder="鶏むね肉 200g / プロテイン" required></div>
          <div class="helptext" style="margin-top:-8px; margin-bottom:12px;">カロリー以下を空欄のまま追加すると、AIが食品名から自動で推定します</div>
          <div class="field-row">
            <div class="field"><label>カロリー (kcal)</label><input type="number" name="calories" step="1"></div>
            <div class="field"><label>時刻</label><input type="time" name="time" value="${new Date().toTimeString().slice(0, 5)}"></div>
          </div>
          <div class="field-row">
            <div class="field"><label>P (g)</label><input type="number" name="proteinG" step="0.1"></div>
            <div class="field"><label>F (g)</label><input type="number" name="fatG" step="0.1"></div>
            <div class="field"><label>C (g)</label><input type="number" name="carbG" step="0.1"></div>
          </div>
          ${selectedExtra.map((n) => `<div class="field"><label>${n.label} (${n.unit})</label><input type="number" step="0.1" name="${n.key}"></div>`).join("")}
          <button class="btn btn-primary" type="submit">追加</button>
        </form>
      </div>

      <div class="section-title">${escapeHtml(fmtDateShort(dietDate))}の記録</div>
      ${
        meals.length === 0
          ? `<div class="card"><div class="empty-state">まだ記録がありません</div></div>`
          : MEAL_TYPES.filter((t) => mealsByType[t.key].length > 0)
              .map(
                (t) => `
        <div class="card-title" style="margin-top:14px;">${t.label}</div>
        <div class="card">${mealsByType[t.key].map(mealItemHtml).join("")}</div>`
              )
              .join("")
      }
    `;

    root.querySelector("#prev-date").addEventListener("click", () => {
      dietDate = Store.addDays(dietDate, -1);
      mealFormType = null;
      Views.diet.render(root);
    });
    const nextBtn = root.querySelector("#next-date");
    if (!isToday) {
      nextBtn.addEventListener("click", () => {
        dietDate = Store.addDays(dietDate, 1);
        mealFormType = null;
        Views.diet.render(root);
      });
    }

    root.querySelectorAll("#mealtype-segmented button").forEach((btn) => {
      btn.addEventListener("click", () => {
        mealFormType = btn.dataset.type;
        root.querySelectorAll("#mealtype-segmented button").forEach((b) => b.classList.toggle("active", b === btn));
      });
    });

    root.querySelector("#meal-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const name = (fd.get("name") || "").trim();
      const caloriesRaw = fd.get("calories");
      const submitBtn = e.target.querySelector('button[type="submit"]');

      let estimated = null;
      if (name && !caloriesRaw) {
        const originalLabel = submitBtn.textContent;
        submitBtn.disabled = true;
        submitBtn.textContent = "AIが推定中...";
        try {
          estimated = await Gemini.estimateNutritionFromText(name, settings.geminiApiKey);
        } catch (err) {
          submitBtn.disabled = false;
          submitBtn.textContent = originalLabel;
          App.toast("AI推定に失敗しました: " + (err.message || String(err)));
          return;
        }
        submitBtn.disabled = false;
        submitBtn.textContent = originalLabel;
      }

      function pick(rawVal, estKey) {
        if (rawVal !== "" && rawVal != null) return parseFloat(rawVal) || 0;
        return estimated ? Math.round((estimated[estKey] || 0) * 10) / 10 : 0;
      }

      const meal = {
        date: dietDate,
        mealType: mealFormType,
        time: fd.get("time") || "",
        name: name,
        calories: pick(caloriesRaw, "calories"),
        proteinG: pick(fd.get("proteinG"), "proteinG"),
        fatG: pick(fd.get("fatG"), "fatG"),
        carbG: pick(fd.get("carbG"), "carbG"),
      };
      selectedExtra.forEach((n) => {
        meal[n.key] = pick(fd.get(n.key), n.key);
      });
      await Store.addMeal(meal);
      mealFormType = null;
      Views.diet.render(root);
    });

    root.querySelector("#suggest-btn").addEventListener("click", async () => {
      const resultBox = root.querySelector("#suggest-result");
      const gaps = Store.getDeficiencies(totals, settings);
      if (gaps.length === 0) {
        resultBox.innerHTML = `<div class="helptext" style="margin-top:8px;">今のところ大きな不足は無さそうです。</div>`;
        return;
      }
      resultBox.innerHTML = `<div class="helptext" style="margin-top:8px;">AIが提案を考え中...</div>`;
      try {
        const suggestions = await Gemini.suggestFoods(gaps, settings.geminiApiKey);
        resultBox.innerHTML = `
          <div style="margin-top:10px;">
            ${suggestions
              .map(
                (s) => `
              <div style="padding:8px 0; border-top:0.5px solid var(--border);">
                <div style="font-size:14px; font-weight:500;">${escapeHtml(s.food)} <span style="color:var(--text-secondary); font-weight:400;">${escapeHtml(s.amount)}</span></div>
                <div class="helptext">${escapeHtml(s.reason)}</div>
              </div>`
              )
              .join("")}
          </div>`;
      } catch (err) {
        resultBox.innerHTML = `<div class="helptext" style="margin-top:8px; color:var(--danger);">提案の取得に失敗しました: ${escapeHtml(err.message || String(err))}</div>`;
      }
    });

    root.querySelector("#photo-input").addEventListener("change", async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const status = root.querySelector("#photo-status");
      status.style.display = "block";
      status.textContent = "AIが写真を解析中...";
      try {
        const result = await Gemini.estimateNutrition(file, settings.geminiApiKey);
        const form = root.querySelector("#meal-form");
        form.elements["name"].value = result.foodName || "";
        form.elements["calories"].value = Math.round(result.calories || 0);
        form.elements["proteinG"].value = Math.round((result.proteinG || 0) * 10) / 10;
        form.elements["fatG"].value = Math.round((result.fatG || 0) * 10) / 10;
        form.elements["carbG"].value = Math.round((result.carbG || 0) * 10) / 10;
        selectedExtra.forEach((n) => {
          if (form.elements[n.key]) form.elements[n.key].value = Math.round((result[n.key] || 0) * 10) / 10;
        });
        status.textContent = "解析結果をフォームに反映しました。内容を確認して「追加」を押してください。";
        form.scrollIntoView({ behavior: "smooth", block: "start" });
      } catch (err) {
        status.textContent = "解析に失敗しました: " + (err.message || String(err));
      }
    });

    root.querySelectorAll("[data-del]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        await Store.deleteMeal(Number(btn.dataset.del));
        Views.diet.render(root);
      });
    });
  },
};

// ===================== トレーニング =====================
let trainingDate = null;
Views.training = {
  title: "トレーニング",
  async render(root) {
    if (!trainingDate) trainingDate = Store.todayStr();
    const [settings, workout, latest, recentWorkouts] = await Promise.all([
      Store.getSettings(),
      Store.getWorkoutForDate(trainingDate),
      Store.getLatestBodyMetric(),
      Store.getWorkoutRange(30),
    ]);
    const exercises = Store.getExercises(settings);
    const isToday = trainingDate === Store.todayStr();
    const entries = workout.entries || [];
    const burned = Store.estimateWorkoutCalories(entries, latest?.weightKg);
    const volume = Store.workoutVolume(entries);

    // 同じ種目の直近の記録を、次回入力時の初期値として使う
    function lastEntryFor(exerciseId) {
      for (let i = recentWorkouts.length - 1; i >= 0; i--) {
        const w = recentWorkouts[i];
        if (w.date >= trainingDate) continue;
        const hit = (w.entries || []).find((e) => e.exerciseId === exerciseId);
        if (hit) return hit;
      }
      return null;
    }

    function optionsHtml(values, selected, suffix) {
      return values.map((v) => `<option value="${v}" ${v === selected ? "selected" : ""}>${v}${suffix}</option>`).join("");
    }

    const trainedDays = recentWorkouts.filter((w) => (w.entries || []).length > 0).length;

    root.innerHTML = `
      <div class="date-nav">
        <button id="prev-date">‹</button>
        <div class="date-label">${escapeHtml(fmtDateShort(trainingDate))}${isToday ? " ・ 今日" : ""}</div>
        <button id="next-date" ${isToday ? "disabled style='opacity:.3'" : ""}>›</button>
      </div>

      <div class="stat-grid">
        <div class="stat-tile">${iconBadge("dumbbell")}<div class="label">総ボリューム</div><div class="value">${n0(volume)}<span class="unit">kg</span></div></div>
        <div class="stat-tile">${iconBadge("flame", "warning")}<div class="label">推定消費</div><div class="value">${n0(burned)}<span class="unit">kcal</span></div></div>
      </div>

      <div class="card">
        <div class="card-title">${iconBadge("target")}直近30日</div>
        <div style="font-size:26px; font-weight:700; font-family:var(--font-serif);">${trainedDays}<span style="font-size:13px; font-weight:400; color:var(--text-secondary);"> 日 実施</span></div>
      </div>

      <div class="section-title">今日のメニュー</div>
      <div class="card">
        <form id="workout-form">
          ${exercises
            .map((ex) => {
              const cur = entries.find((e) => e.exerciseId === ex.id);
              const prev = lastEntryFor(ex.id);
              const checked = !!cur;
              const w = cur?.weightKg ?? prev?.weightKg ?? 20;
              const r = cur?.reps ?? prev?.reps ?? 10;
              const s = cur?.sets ?? prev?.sets ?? 3;
              return `
            <div style="padding:12px 0; border-bottom:0.5px solid var(--border-soft);">
              <label style="display:flex; align-items:center; gap:9px; font-size:15px; font-weight:500; margin-bottom:8px;">
                <input type="checkbox" name="do_${ex.id}" ${checked ? "checked" : ""} data-ex="${ex.id}">
                ${escapeHtml(ex.name)}
                ${prev && !cur ? `<span class="tag" style="font-weight:400;">前回 ${prev.weightKg}kg</span>` : ""}
              </label>
              <div style="display:flex; gap:8px;" data-fields="${ex.id}" ${checked ? "" : 'hidden'}>
                <select name="w_${ex.id}" style="flex:1; border:0.5px solid var(--border-soft); background:var(--surface-2); border-radius:10px; padding:9px; font-size:15px; color:var(--text);">
                  ${optionsHtml(WEIGHT_OPTIONS, w, "kg")}
                </select>
                <select name="r_${ex.id}" style="flex:1; border:0.5px solid var(--border-soft); background:var(--surface-2); border-radius:10px; padding:9px; font-size:15px; color:var(--text);">
                  ${optionsHtml(REP_OPTIONS, r, "回")}
                </select>
                <select name="s_${ex.id}" style="flex:1; border:0.5px solid var(--border-soft); background:var(--surface-2); border-radius:10px; padding:9px; font-size:15px; color:var(--text);">
                  ${optionsHtml(SET_OPTIONS, s, "セット")}
                </select>
              </div>
            </div>`;
            })
            .join("")}
          <button class="btn btn-primary" type="submit" style="margin-top:14px;">この日の記録を保存</button>
        </form>
        <div class="helptext">重量と回数は5刻み。チェックした種目だけが保存されます。前回の値が自動で入ります。</div>
      </div>

      <div class="section-title">種目の設定</div>
      <div class="card">
        <div class="helptext" style="margin-bottom:10px;">よく行う種目を登録しておくと、毎日はチェックを入れるだけで記録できます。</div>
        <div id="exercise-list">
          ${exercises
            .map(
              (ex) => `
          <div class="list-item">
            <div class="name">${escapeHtml(ex.name)}</div>
            <button class="del-btn" data-del-ex="${ex.id}" aria-label="削除">×</button>
          </div>`
            )
            .join("")}
        </div>
        <form id="add-exercise-form" style="display:flex; gap:8px; margin-top:12px;">
          <input type="text" name="exName" placeholder="種目を追加" required
            style="flex:1; border:0.5px solid var(--border-soft); background:var(--surface-2); border-radius:12px; padding:11px 12px; font-size:16px; color:var(--text);">
          <button class="btn" type="submit" style="width:auto; padding:11px 18px;">追加</button>
        </form>
      </div>

      <div class="section-title">最近の記録</div>
      ${
        recentWorkouts.filter((w) => (w.entries || []).length > 0).length === 0
          ? `<div class="card"><div class="empty-state">まだ記録がありません</div></div>`
          : `<div class="card">${[...recentWorkouts]
              .reverse()
              .filter((w) => (w.entries || []).length > 0)
              .slice(0, 10)
              .map(
                (w) => `
          <div class="list-item">
            <div>
              <div class="name">${escapeHtml(fmtDateShort(w.date))}</div>
              <div class="meta">${w.entries.map((e) => `${escapeHtml(e.name)} ${e.weightKg}kg×${e.reps}×${e.sets}`).join(" ・ ")}</div>
            </div>
            <span class="amount">${n0(Store.workoutVolume(w.entries))} kg</span>
          </div>`
              )
              .join("")}</div>`
      }
    `;

    root.querySelector("#prev-date").addEventListener("click", () => {
      trainingDate = Store.addDays(trainingDate, -1);
      Views.training.render(root);
    });
    if (!isToday) {
      root.querySelector("#next-date").addEventListener("click", () => {
        trainingDate = Store.addDays(trainingDate, 1);
        Views.training.render(root);
      });
    }

    root.querySelectorAll("[data-ex]").forEach((cb) => {
      cb.addEventListener("change", () => {
        const fields = root.querySelector(`[data-fields="${cb.dataset.ex}"]`);
        if (fields) fields.hidden = !cb.checked;
      });
    });

    root.querySelector("#workout-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const newEntries = exercises
        .filter((ex) => fd.get(`do_${ex.id}`) != null)
        .map((ex) => ({
          exerciseId: ex.id,
          name: ex.name,
          weightKg: parseFloat(fd.get(`w_${ex.id}`)) || 0,
          reps: parseInt(fd.get(`r_${ex.id}`), 10) || 0,
          sets: parseInt(fd.get(`s_${ex.id}`), 10) || 0,
        }));
      await Store.saveWorkout(trainingDate, newEntries);
      App.toast("保存しました");
      Views.training.render(root);
    });

    root.querySelector("#add-exercise-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const name = (new FormData(e.target).get("exName") || "").trim();
      if (!name) return;
      const next = [...exercises, { id: "ex" + Date.now(), name }];
      await Store.saveExercises(next);
      Views.training.render(root);
    });

    root.querySelectorAll("[data-del-ex]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const next = exercises.filter((ex) => ex.id !== btn.dataset.delEx);
        await Store.saveExercises(next);
        Views.training.render(root);
      });
    });
  },
};

// ===================== データ取込(設定タブ内のセクション) =====================
function importSectionHtml(settings) {
  const lastInfo = settings.lastImportAt
    ? `<div class="tag" style="margin-top:10px;">前回: ${new Date(settings.lastImportAt).toLocaleString("ja-JP")}</div>`
    : "";

  return `
      <div class="section-title">ヘルスケアデータの取込</div>
      <div class="card">
        <ol class="helptext" style="padding-left:18px; margin:0;">
          <li>iPhoneで「ヘルスケア」アプリを開く</li>
          <li>右上のプロフィールアイコンをタップ</li>
          <li>一番下の「すべての健康データを書き出す」をタップ (export.zip が作られます)</li>
          <li>「”Files”に保存」を選び、iPhone内(このApp内 / iCloud Drive等)に保存する</li>
          <li>このページ（Safari）に戻り、下のボタンから <b>export.zip をそのまま</b>選ぶ（展開は不要、アプリ内で自動で展開します）</li>
        </ol>
        <div class="helptext" style="margin-top:8px;">※あらかじめ展開済みの export.xml や、PCに転送したファイルを選んでも構いません。</div>
      </div>

      <label class="import-drop" for="xml-input">
        <div style="font-size:15px; color:var(--text); margin-bottom:4px;">export.zip / export.xml を選択</div>
        <div>タップしてファイルを選んでください</div>
        <input type="file" id="xml-input" accept=".zip,.xml">
      </label>

      <div id="import-progress" hidden>
        <div class="progress-line"><div id="import-progress-bar"></div></div>
        <div class="helptext" id="import-status">解析中...</div>
      </div>

      <div id="import-result"></div>

      ${lastInfo}
    `;
}

function bindImportHandlers(root) {
  root.querySelector("#xml-input").addEventListener("change", async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const progressWrap = root.querySelector("#import-progress");
      const bar = root.querySelector("#import-progress-bar");
      const status = root.querySelector("#import-status");
      const resultBox = root.querySelector("#import-result");
      progressWrap.hidden = false;
      resultBox.innerHTML = "";
      try {
        let xmlFile = file;
        const nameLooksZip = /\.zip$/i.test(file.name);
        if (nameLooksZip || (await Zip.looksLikeZip(file))) {
          status.textContent = "ZIPを展開中...";
          bar.style.width = "0%";
          xmlFile = await Zip.extractFirstMatch(file, (name) => /(^|\/)export\.xml$/i.test(name));
        }
        const parsed = await HealthImport.parseFile(xmlFile, (ratio) => {
          bar.style.width = Math.round(ratio * 100) + "%";
          status.textContent = `解析中... ${Math.round(ratio * 100)}%`;
        });
        status.textContent = "保存中...";
        await HealthImport.saveToDb(parsed);
        progressWrap.hidden = true;
        resultBox.innerHTML = `
          <div class="card">
            <div class="card-title">取込完了</div>
            <div class="helptext">
              期間: ${parsed.dateMin || "--"} 〜 ${parsed.dateMax || "--"}<br>
              体重 ${parsed.counts.bodyMass}件 ・ 体脂肪率 ${parsed.counts.bodyFat}件 ・ 歩数 ${parsed.counts.steps}件<br>
              活動カロリー ${parsed.counts.activeEnergy}件 ・ 睡眠 ${parsed.counts.sleep}件 ・ 心拍 ${parsed.counts.heartRate}件
            </div>
          </div>`;
        App.toast("取込が完了しました");
      } catch (err) {
        progressWrap.hidden = true;
        resultBox.innerHTML = `<div class="card"><div class="card-title" style="color:var(--danger)">読み込みに失敗しました</div><div class="helptext">${escapeHtml(err.message || String(err))}</div></div>`;
      }
    });
}

// ===================== 設定 =====================
Views.settings = {
  title: "設定",
  async render(root) {
    const settings = await Store.getSettings();
    const latest = await Store.getLatestBodyMetric();
    const auto = settings.useAutoTargets;
    const suggestion = auto ? await Store.computeAutoTargets(settings, latest?.weightKg) : null;
    const nutrientSuggestions = Store.computeNutrientTargets(settings, suggestion?.calories ?? settings.targetCalories);

    root.innerHTML = `
      <div class="section-title">プロフィール</div>
      <div class="card">
        <form id="profile-form">
          <div class="field-row">
            <div class="field"><label>身長 (cm)</label><input type="number" name="heightCm" value="${settings.heightCm ?? ""}"></div>
            <div class="field"><label>年齢</label><input type="number" name="age" value="${settings.age ?? ""}"></div>
          </div>
          <div class="field-row">
            <div class="field">
              <label>性別</label>
              <select name="sex">
                <option value="male" ${settings.sex === "male" ? "selected" : ""}>男性</option>
                <option value="female" ${settings.sex === "female" ? "selected" : ""}>女性</option>
              </select>
            </div>
            <div class="field">
              <label>活動レベル</label>
              <select name="activityLevel">
                <option value="sedentary" ${settings.activityLevel === "sedentary" ? "selected" : ""}>低い(デスクワーク中心)</option>
                <option value="light" ${settings.activityLevel === "light" ? "selected" : ""}>やや低い(週1-3運動)</option>
                <option value="moderate" ${settings.activityLevel === "moderate" ? "selected" : ""}>普通(週3-5運動)</option>
                <option value="active" ${settings.activityLevel === "active" ? "selected" : ""}>高い(週6-7運動)</option>
                <option value="veryActive" ${settings.activityLevel === "veryActive" ? "selected" : ""}>非常に高い(肉体労働)</option>
              </select>
            </div>
          </div>
          <div class="field-row">
            <div class="field">
              <label>目標</label>
              <select name="goalType">
                <option value="cut" ${settings.goalType === "cut" ? "selected" : ""}>減量</option>
                <option value="maintain" ${settings.goalType === "maintain" ? "selected" : ""}>維持</option>
                <option value="bulk" ${settings.goalType === "bulk" ? "selected" : ""}>増量</option>
              </select>
            </div>
            <div class="field"><label>目標体重 (kg)</label><input type="number" step="0.1" name="targetWeightKg" value="${settings.targetWeightKg ?? ""}"></div>
          </div>
          <button class="btn btn-primary" type="submit">プロフィールを保存</button>
        </form>
      </div>

      <div class="section-title">摂取目標</div>
      <div class="card">
        <label style="display:flex; align-items:center; gap:8px; font-size:14px; margin-bottom:12px;">
          <input type="checkbox" id="auto-target" ${auto ? "checked" : ""}> 身長・年齢・体重から自動計算する
        </label>
        ${
          auto
            ? suggestion
              ? `<div class="helptext" style="margin-bottom:10px;">推定TDEE ${n0(suggestion.tdee)} kcal → 目標 ${n0(suggestion.calories)} kcal (P${n0(suggestion.proteinG)}/F${n0(suggestion.fatG)}/C${n0(suggestion.carbG)}g)</div>`
              : `<div class="helptext" style="margin-bottom:10px;">身長・年齢を入力すると自動計算できます</div>`
            : ""
        }
        <form id="target-form">
          <div class="field-row">
            <div class="field"><label>カロリー (kcal)</label><input type="number" name="targetCalories" value="${suggestion?.calories ?? settings.targetCalories ?? ""}" ${auto ? "readonly" : ""}></div>
            <div class="field"><label>タンパク質 (g)</label><input type="number" name="targetProteinG" value="${suggestion?.proteinG ?? settings.targetProteinG ?? ""}" ${auto ? "readonly" : ""}></div>
          </div>
          <div class="field-row">
            <div class="field"><label>脂質 (g)</label><input type="number" name="targetFatG" value="${suggestion?.fatG ?? settings.targetFatG ?? ""}" ${auto ? "readonly" : ""}></div>
            <div class="field"><label>炭水化物 (g)</label><input type="number" name="targetCarbG" value="${suggestion?.carbG ?? settings.targetCarbG ?? ""}" ${auto ? "readonly" : ""}></div>
          </div>
          <button class="btn btn-primary" type="submit">目標を保存</button>
        </form>
      </div>

      <div class="section-title">写真からの栄養推定 (AI)</div>
      <div class="card">
        <div class="helptext" style="margin-bottom:10px;">
          食事タブで写真を撮ると、Gemini APIで栄養価を推定します。ご自身のAPIキーが必要です
          （<a href="https://aistudio.google.com/" target="_blank" rel="noopener">Google AI Studio</a>
          の「Get API key」から無料で発行できます）。キーはこの端末のブラウザ内にのみ保存され、Google以外には送信されません。
        </div>
        <form id="gemini-form">
          <div class="field">
            <label>Gemini APIキー</label>
            <input type="password" name="geminiApiKey" value="${escapeHtml(settings.geminiApiKey || "")}" placeholder="AIza...">
          </div>
          <button class="btn btn-primary" type="submit">保存</button>
        </form>
      </div>

      <div class="section-title">追跡する栄養素</div>
      <div class="card">
        <div class="helptext" style="margin-bottom:10px;">カロリー・P/F/C以外に気にしたい項目を選ぶと、食事タブに進捗と不足表示が追加されます。目標値は性別・年齢・摂取カロリーから自動で見積もった目安値です（編集して保存すると上書きされます）。</div>
        <form id="nutrients-form">
          ${NUTRIENT_CATALOG.map((n) => {
            const isSelected = (settings.selectedNutrients || []).includes(n.key);
            const targetVal = settings.extraTargets?.[n.key] ?? nutrientSuggestions[n.key] ?? n.defaultTarget;
            return `
            <div style="display:flex; align-items:center; gap:10px; padding:8px 0; border-bottom:0.5px solid var(--border);">
              <label style="display:flex; align-items:center; gap:8px; flex:1; font-size:14px;">
                <input type="checkbox" name="nutrient" value="${n.key}" ${isSelected ? "checked" : ""}>
                ${n.label}
              </label>
              <input type="number" step="0.1" name="target_${n.key}" value="${targetVal}" ${isSelected ? "" : "disabled"}
                style="width:84px; border:0.5px solid var(--border); background:var(--surface-2); border-radius:8px; padding:6px 8px; font-size:14px; color:var(--text);">
              <span style="font-size:12px; color:var(--text-muted); width:26px;">${n.unit}</span>
            </div>`;
          }).join("")}
          <button class="btn btn-primary" type="submit" style="margin-top:12px;">保存</button>
        </form>
      </div>

      ${importSectionHtml(settings)}

      <div class="section-title">データ管理</div>
      <div class="card">
        <button class="btn" id="export-btn" style="margin-bottom:10px;">バックアップを書き出す (JSON)</button>
        <label class="btn" style="margin-bottom:10px; display:block; text-align:center;">
          バックアップを読み込む
          <input type="file" id="restore-input" accept="application/json" style="display:none;">
        </label>
        <button class="btn btn-danger" id="wipe-btn">全データを削除</button>
      </div>
    `;

    bindImportHandlers(root);

    root.querySelector("#profile-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      await Store.saveSettings({
        heightCm: fd.get("heightCm") ? parseFloat(fd.get("heightCm")) : null,
        age: fd.get("age") ? parseInt(fd.get("age"), 10) : null,
        sex: fd.get("sex"),
        activityLevel: fd.get("activityLevel"),
        goalType: fd.get("goalType"),
        targetWeightKg: fd.get("targetWeightKg") ? parseFloat(fd.get("targetWeightKg")) : null,
      });
      App.toast("保存しました");
      Views.settings.render(root);
    });

    root.querySelector("#auto-target").addEventListener("change", async (e) => {
      await Store.saveSettings({ useAutoTargets: e.target.checked });
      Views.settings.render(root);
    });

    root.querySelector("#target-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      await Store.saveSettings({
        targetCalories: parseFloat(fd.get("targetCalories")) || 0,
        targetProteinG: parseFloat(fd.get("targetProteinG")) || 0,
        targetFatG: parseFloat(fd.get("targetFatG")) || 0,
        targetCarbG: parseFloat(fd.get("targetCarbG")) || 0,
      });
      App.toast("目標を保存しました");
      Views.settings.render(root);
    });

    root.querySelector("#gemini-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      await Store.saveSettings({ geminiApiKey: (fd.get("geminiApiKey") || "").trim() });
      App.toast("APIキーを保存しました");
    });

    root.querySelectorAll('#nutrients-form input[name="nutrient"]').forEach((cb) => {
      cb.addEventListener("change", () => {
        const targetInput = root.querySelector(`input[name="target_${cb.value}"]`);
        if (targetInput) targetInput.disabled = !cb.checked;
      });
    });

    root.querySelector("#nutrients-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const selectedNutrients = fd.getAll("nutrient");
      const extraTargets = { ...settings.extraTargets };
      NUTRIENT_CATALOG.forEach((n) => {
        const v = fd.get(`target_${n.key}`);
        if (v) extraTargets[n.key] = parseFloat(v);
      });
      await Store.saveSettings({ selectedNutrients, extraTargets });
      App.toast("保存しました");
      Views.settings.render(root);
    });

    root.querySelector("#export-btn").addEventListener("click", async () => {
      const dump = {};
      for (const store of ["bodyMetrics", "activity", "meals", "workouts", "settings"]) {
        dump[store] = await DB.getAll(store);
      }
      const blob = new Blob([JSON.stringify(dump, null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `body-tracker-backup-${Store.todayStr()}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
    });

    root.querySelector("#restore-input").addEventListener("change", async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const data = JSON.parse(await file.text());
        for (const store of ["bodyMetrics", "activity", "meals", "workouts", "settings"]) {
          if (Array.isArray(data[store]) && data[store].length) await DB.putMany(store, data[store]);
        }
        App.toast("復元しました");
        Views.settings.render(root);
      } catch (err) {
        App.toast("復元に失敗しました");
      }
    });

    root.querySelector("#wipe-btn").addEventListener("click", async () => {
      if (!confirm("すべてのデータを削除します。よろしいですか？")) return;
      for (const store of ["bodyMetrics", "activity", "meals", "workouts", "settings"]) await DB.clear(store);
      App.toast("削除しました");
      Views.settings.render(root);
    });
  },
};
