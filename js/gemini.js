// Google Gemini APIを使い、食事の写真から栄養価を推定する。
// APIキーはユーザー自身のものをブラウザ内(IndexedDB)にのみ保存し、Google以外には送信しない。
const Gemini = (() => {
  const MODEL = "gemini-3-flash-preview";

  const RESPONSE_SCHEMA = {
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

  /**
   * @param {File} imageFile
   * @param {string} apiKey
   * @returns {Promise<object>} 推定された栄養素(calories, proteinG, fatG, carbG, foodName等)
   */
  async function estimateNutrition(imageFile, apiKey) {
    if (!apiKey) throw new Error("Gemini APIキーが設定されていません。設定タブで登録してください。");

    const base64 = await fileToBase64(imageFile);
    const mimeType = imageFile.type || "image/jpeg";

    const body = {
      contents: [
        {
          parts: [
            {
              text: "この写真に写っている食事の栄養価を推定してください。皿の大きさや量から常識的な1人前として概算し、数値のみで回答してください。写っていない/分からない項目は0にしてください。foodNameは短い日本語の料理名にしてください。",
            },
            { inlineData: { mimeType, data: base64 } },
          ],
        },
      ],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: RESPONSE_SCHEMA,
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

  return { estimateNutrition };
})();
