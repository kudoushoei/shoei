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
    const [bodyRows, activityRows, latest, settings] = await Promise.all([
      Store.getBodyMetricsRange(14),
      Store.getActivityRange(7),
      Store.getLatestBodyMetric(),
      Store.getSettings(),
    ]);
    const today = Store.todayStr();
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

    const calTarget = settings.targetCalories;
    const calPct = calTarget ? Math.min(100, Math.round((totals.calories / calTarget) * 100)) : 0;

    let importTag;
    if (!settings.lastImportAt) {
      importTag = `<span class="tag warning">ヘルスケア未取込</span>`;
    } else {
      const d = daysSince(settings.lastImportAt);
      const label = d <= 0 ? "今日取込済み" : `最終取込: ${d}日前`;
      importTag = `<span class="tag ${d >= 3 ? "warning" : ""}">${label}</span>`;
    }

    root.innerHTML = `
      <div class="card" id="import-jump" style="cursor:pointer;">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <span class="card-title" style="margin:0;">ヘルスケアデータ</span>
          ${importTag}
        </div>
        <div class="helptext">タップして取込画面へ（export.zipをそのまま選べます。展開もPCへの転送も不要です）</div>
      </div>

      <div class="card">
        <div class="card-title">体重</div>
        <div style="display:flex; align-items:baseline; gap:10px; flex-wrap:wrap;">
          <span style="font-size:30px; font-weight:600;">${latest ? n1(latest.weightKg) : "--"}<span style="font-size:14px;font-weight:400;color:var(--text-secondary)"> kg</span></span>
          ${deltaHtml}
        </div>
        ${latest ? `<div class="helptext">最終記録: ${escapeHtml(fmtDateShort(latest.date))}</div>` : `<div class="helptext">「取込」からヘルスケアデータを読み込むか、「体組成」タブで手入力できます</div>`}
      </div>

      <div class="stat-grid">
        <div class="stat-tile"><div class="label">歩数</div><div class="value">${n0(todayActivity.steps)}<span class="unit">歩</span></div></div>
        <div class="stat-tile"><div class="label">消費カロリー</div><div class="value">${n0(todayActivity.activeEnergyKcal)}<span class="unit">kcal</span></div></div>
        <div class="stat-tile"><div class="label">睡眠</div><div class="value">${n1(todayActivity.sleepHours)}<span class="unit">h</span></div></div>
        <div class="stat-tile"><div class="label">摂取カロリー</div><div class="value">${n0(totals.calories)}<span class="unit">kcal</span></div></div>
      </div>

      <div class="card" id="diet-jump" style="margin-top:12px; cursor:pointer;">
        <div class="card-title">今日の食事 (目標 ${n0(calTarget)} kcal)</div>
        <div class="progress-bar ${calPct >= 100 && totals.calories > calTarget ? "over" : ""}"><div style="width:${calPct}%"></div></div>
        <div class="helptext">P ${n0(totals.proteinG)}g ・ F ${n0(totals.fatG)}g ・ C ${n0(totals.carbG)}g　タップして記録する</div>
      </div>

      <div class="section-title">直近7日の活動</div>
      <div class="card"><div class="card-title">歩数</div><div class="chart-wrap">${Charts.lineChart(stepsSeries, { unit: "歩" })}</div></div>
      <div class="card"><div class="card-title">睡眠時間</div><div class="chart-wrap">${Charts.lineChart(sleepSeries, { unit: "h" })}</div></div>
    `;

    root.querySelector("#diet-jump").addEventListener("click", () => App.showView("diet"));
    root.querySelector("#import-jump").addEventListener("click", () => App.showView("import"));
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
Views.diet = {
  title: "食事",
  async render(root) {
    if (!dietDate) dietDate = Store.todayStr();
    const [settings, meals] = await Promise.all([Store.getSettings(), Store.getMealsForDate(dietDate)]);
    const totals = Store.sumMeals(meals);
    const isToday = dietDate === Store.todayStr();

    function row(label, value, target, unit) {
      const pct = target ? Math.min(100, Math.round((value / target) * 100)) : 0;
      const over = target && value > target;
      return `
        <div style="margin-bottom:10px;">
          <div style="display:flex; justify-content:space-between; font-size:13px;">
            <span style="color:var(--text-secondary)">${label}</span>
            <span>${n0(value)} / ${target ? n0(target) : "--"} ${unit}</span>
          </div>
          <div class="progress-bar ${over ? "over" : ""}"><div style="width:${pct}%"></div></div>
        </div>`;
    }

    root.innerHTML = `
      <div class="date-nav">
        <button id="prev-date">‹</button>
        <div class="date-label">${escapeHtml(fmtDateShort(dietDate))}${isToday ? " ・ 今日" : ""}</div>
        <button id="next-date" ${isToday ? "disabled style='opacity:.3'" : ""}>›</button>
      </div>

      <div class="card">
        <div class="card-title">摂取まとめ</div>
        ${row("カロリー", totals.calories, settings.targetCalories, "kcal")}
        ${row("タンパク質", totals.proteinG, settings.targetProteinG, "g")}
        ${row("脂質", totals.fatG, settings.targetFatG, "g")}
        ${row("炭水化物", totals.carbG, settings.targetCarbG, "g")}
      </div>

      <div class="section-title">記録を追加</div>
      <div class="card">
        <form id="meal-form">
          <div class="field"><label>食品名</label><input type="text" name="name" placeholder="鶏むね肉 200g" required></div>
          <div class="field-row">
            <div class="field"><label>カロリー (kcal)</label><input type="number" name="calories" step="1" required></div>
            <div class="field"><label>時刻</label><input type="time" name="time" value="${new Date().toTimeString().slice(0, 5)}"></div>
          </div>
          <div class="field-row">
            <div class="field"><label>P (g)</label><input type="number" name="proteinG" step="0.1"></div>
            <div class="field"><label>F (g)</label><input type="number" name="fatG" step="0.1"></div>
            <div class="field"><label>C (g)</label><input type="number" name="carbG" step="0.1"></div>
          </div>
          <button class="btn btn-primary" type="submit">追加</button>
        </form>
      </div>

      <div class="section-title">${escapeHtml(fmtDateShort(dietDate))}の記録</div>
      <div class="card">
        ${
          meals.length === 0
            ? `<div class="empty-state">まだ記録がありません</div>`
            : meals
                .map(
                  (m) => `
          <div class="list-item">
            <div>
              <div class="name">${escapeHtml(m.name)}</div>
              <div class="meta">${m.time || ""} ・ P${n0(m.proteinG)} F${n0(m.fatG)} C${n0(m.carbG)}</div>
            </div>
            <div style="display:flex; align-items:center;">
              <span class="amount">${n0(m.calories)} kcal</span>
              <button class="del-btn" data-del="${m.id}" aria-label="削除">×</button>
            </div>
          </div>`
                )
                .join("")
        }
      </div>
    `;

    root.querySelector("#prev-date").addEventListener("click", () => {
      dietDate = Store.addDays(dietDate, -1);
      Views.diet.render(root);
    });
    const nextBtn = root.querySelector("#next-date");
    if (!isToday) {
      nextBtn.addEventListener("click", () => {
        dietDate = Store.addDays(dietDate, 1);
        Views.diet.render(root);
      });
    }
    root.querySelector("#meal-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      await Store.addMeal({
        date: dietDate,
        time: fd.get("time") || "",
        name: fd.get("name"),
        calories: parseFloat(fd.get("calories")) || 0,
        proteinG: parseFloat(fd.get("proteinG")) || 0,
        fatG: parseFloat(fd.get("fatG")) || 0,
        carbG: parseFloat(fd.get("carbG")) || 0,
      });
      Views.diet.render(root);
    });
    root.querySelectorAll("[data-del]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        await Store.deleteMeal(Number(btn.dataset.del));
        Views.diet.render(root);
      });
    });
  },
};

// ===================== データ取込 =====================
Views.import = {
  title: "データ取込",
  async render(root) {
    const settings = await Store.getSettings();
    const lastInfo = settings.lastImportAt
      ? `<div class="tag">前回: ${new Date(settings.lastImportAt).toLocaleString("ja-JP")}</div>`
      : "";

    root.innerHTML = `
      <div class="card">
        <div class="card-title">iPhoneのヘルスケアデータを取り込む</div>
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
        <input type="file" id="xml-input" accept=".zip,.xml,application/zip,text/xml">
      </label>

      <div id="import-progress" hidden>
        <div class="progress-line"><div id="import-progress-bar"></div></div>
        <div class="helptext" id="import-status">解析中...</div>
      </div>

      <div id="import-result"></div>

      ${lastInfo}
    `;

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
  },
};

// ===================== 設定 =====================
Views.settings = {
  title: "設定",
  async render(root) {
    const settings = await Store.getSettings();
    const latest = await Store.getLatestBodyMetric();
    const auto = settings.useAutoTargets;
    const suggestion = auto ? await Store.computeAutoTargets(settings, latest?.weightKg) : null;

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

    root.querySelector("#export-btn").addEventListener("click", async () => {
      const dump = {};
      for (const store of ["bodyMetrics", "activity", "meals", "settings"]) {
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
        for (const store of ["bodyMetrics", "activity", "meals", "settings"]) {
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
      for (const store of ["bodyMetrics", "activity", "meals", "settings"]) await DB.clear(store);
      App.toast("削除しました");
      Views.settings.render(root);
    });
  },
};
