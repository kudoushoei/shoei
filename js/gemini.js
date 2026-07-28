// Google Gemini APIを使い、(1)食事の写真から栄養価を推定、(2)不足栄養素を補う食品を提案する。
// APIキーはユーザー自身のものをブラウザ内(IndexedDB)にのみ保存し、Google以外には送信しない。
const Gemini = (() => {
  const MODEL = "gemini-3-flash-preview";

  const NUTRITION_SCHEMA = {
    type: "OBJECT",
    properties: {
      foodName: { type: "STRING" },
      calories: { type: "NUMBER" },
      proteinG: { type: "NUMBER" },
      fatG: { type: "NUMBER" },
      carbG: { type: "NUMBER" },
      fiberG: { type: "NUMBER" },
      sugarG: { type: "NUMBER" },
      sodiumMg: { type: "NUMBER" },
      calciumMg: { type: "NUMBER" },
      ironMg: { type: "NUMBER" },
      potassiumMg: { type: "NUMBER" },
      vitaminCMg: { type: "NUMBER" },
      note: { type: "STRING" },
    },
    required: ["foodName", "calories", "proteinG", "fatG", "carbG"],
  };

  const SUGGESTION_SCHEMA = {
    type: "OBJECT",
    properties: {
      suggestions: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          properties: {
            food: { type: "STRING" },
            amount: { type: "STRING" },
            reason: { type: "STRING" },
          },
          required: ["food", "amount", "reason"],
        },
      },
    },
    required: ["suggestions"],
  };

  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
      reader.onerror = () => reject(reader.error || new Error("画像の読み込みに失敗しました"));
      reader.readAsDataURL(file);
    });
  }

  function extractJson(text) {
    const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    const body = fenceMatch ? fenceMatch[1] : text;
    return JSON.parse(body);
  }

  async function callGemini(parts, schema, apiKey) {
    if (!apiKey) throw new Error("Gemini APIキーが設定されていません。設定タブで登録してください。");

    const body = {
      contents: [{ parts }],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: schema,
      },
    };

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`;
    let res;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch (e) {
      throw new Error("Gemini APIに接続できませんでした。通信環境を確認してください。");
    }

    if (!res.ok) {
      if (res.status === 400 || res.status === 403) {
        throw new Error("APIキーが無効です。設定タブでキーを確認してください。");
      }
      if (res.status === 429) {
        throw new Error("Gemini APIの利用上限に達しました。しばらく待ってから再試行してください。");
      }
      const errText = await res.text().catch(() => "");
      throw new Error(`AI解析に失敗しました (${res.status}) ${errText.slice(0, 200)}`);
    }

    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      const blockReason = data?.promptFeedback?.blockReason;
      throw new Error(blockReason ? `AIが解析を拒否しました(${blockReason})` : "AIから有効な応答が得られませんでした。");
    }

    try {
      return extractJson(text);
    } catch {
      throw new Error("AIの応答を解析できませんでした。もう一度お試しください。");
    }
  }

  /**
   * @param {File} imageFile
   * @param {string} apiKey
   * @returns {Promise<object>} 推定された栄養素(calories, proteinG, fatG, carbG, foodName等)
   */
  async function estimateNutrition(imageFile, apiKey) {
    const base64 = await fileToBase64(imageFile);
    const mimeType = imageFile.type || "image/jpeg";
    const parts = [
      {
        text: "この写真に写っている食事の栄養価を推定してください。皿の大きさや量から常識的な1人前として概算し、数値のみで回答してください。写っていない/分からない項目は0にしてください。foodNameは短い日本語の料理名にしてください。",
      },
      { inlineData: { mimeType, data: base64 } },
    ];
    return callGemini(parts, NUTRITION_SCHEMA, apiKey);
  }

  /**
   * @param {{label:string, remaining:number, unit:string}[]} gaps 不足している栄養素
   * @param {string} apiKey
   * @returns {Promise<{food:string, amount:string, reason:string}[]>}
   */
  async function suggestFoods(gaps, apiKey) {
    const gapText = gaps.map((g) => `- ${g.label}: 目標まであと${g.remaining}${g.unit}不足`).join("\n");
    const prompt = `以下は今日の栄養素の不足状況です。\n${gapText}\n\nこれらを補うのに適した、日本のコンビニやスーパーで手に入る具体的な食品を2〜3個、それぞれ量(g・個数など)とともに提案してください。reasonには、その食品が何の栄養素をどれくらい補えるかを一言で書いてください。`;
    const result = await callGemini([{ text: prompt }], SUGGESTION_SCHEMA, apiKey);
    return result.suggestions || [];
  }

  /**
   * 食品名(例: "鶏むね肉 200g", "プロテイン")だけから栄養価を推定する。
   * @param {string} foodName
   * @param {string} apiKey
   * @returns {Promise<object>} 推定された栄養素(calories, proteinG, fatG, carbG, foodName等)
   */
  async function estimateNutritionFromText(foodName, apiKey) {
    const prompt = `次の食品/食事の栄養価を推定してください:「${foodName}」。量の指定が無い場合は一般的な1人前として概算してください。数値のみで回答し、分からない項目は0にしてください。foodNameは入力内容をもとにした分かりやすい短い名前にしてください。`;
    return callGemini([{ text: prompt }], NUTRITION_SCHEMA, apiKey);
  }

  return { estimateNutrition, estimateNutritionFromText, suggestFoods };
})();
