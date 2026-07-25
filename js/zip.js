// 依存ライブラリ無しの最小限のZIP展開。
// export.zip の中から目的のファイル(例: export.xml)を1つ取り出すためだけの実装で、
// 圧縮(deflate)の解凍はブラウザ標準のCompressionStreams APIに任せている。
const Zip = (() => {
  const EOCD_SIG = 0x06054b50;
  const CEN_SIG = 0x02014b50;
  const LOC_SIG = 0x04034b50;

  async function looksLikeZip(file) {
    const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
    return head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04;
  }

  function findEOCD(view, bufLen) {
    const searchLen = Math.min(bufLen, 65557);
    for (let i = bufLen - 22; i >= bufLen - searchLen && i >= 0; i--) {
      if (view.getUint32(i, true) === EOCD_SIG) return i;
    }
    throw new Error("ZIPの終端レコードが見つかりません（壊れているか非対応の形式です）");
  }

  /**
   * @param {File|Blob} file
   * @param {(name:string)=>boolean} matcher
   * @returns {Promise<Blob>} 展開後のファイル内容
   */
  async function extractFirstMatch(file, matcher) {
    const buf = await file.arrayBuffer();
    const view = new DataView(buf);
    const bytes = new Uint8Array(buf);
    const decoder = new TextDecoder();

    const eocdOffset = findEOCD(view, buf.byteLength);
    let centralDirOffset = view.getUint32(eocdOffset + 16, true);
    let totalEntries = view.getUint16(eocdOffset + 10, true);
    if (centralDirOffset === 0xffffffff || totalEntries === 0xffff) {
      throw new Error("このZIPは4GBを超えるサイズ(ZIP64)のため非対応です。export.xmlを手動で展開して選択してください。");
    }

    let offset = centralDirOffset;
    let match = null;
    for (let i = 0; i < totalEntries; i++) {
      if (view.getUint32(offset, true) !== CEN_SIG) break;
      const compMethod = view.getUint16(offset + 10, true);
      const compSize = view.getUint32(offset + 20, true);
      const nameLen = view.getUint16(offset + 28, true);
      const extraLen = view.getUint16(offset + 30, true);
      const commentLen = view.getUint16(offset + 32, true);
      const localHeaderOffset = view.getUint32(offset + 42, true);
      const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLen));

      if (!match && matcher(name)) {
        match = { name, compMethod, compSize, localHeaderOffset };
      }
      offset += 46 + nameLen + extraLen + commentLen;
    }

    if (!match) throw new Error("ZIP内に目的のファイルが見つかりませんでした");

    const lh = match.localHeaderOffset;
    if (view.getUint32(lh, true) !== LOC_SIG) throw new Error("ZIPのローカルヘッダが不正です");
    const lNameLen = view.getUint16(lh + 26, true);
    const lExtraLen = view.getUint16(lh + 28, true);
    const dataStart = lh + 30 + lNameLen + lExtraLen;
    const compressedBytes = bytes.subarray(dataStart, dataStart + match.compSize);

    if (match.compMethod === 0) {
      return new Blob([compressedBytes]);
    }
    if (match.compMethod === 8) {
      if (typeof DecompressionStream === "undefined") {
        throw new Error("このブラウザはZIPの解凍に対応していません。export.xmlを手動で展開して選択してください。");
      }
      const ds = new DecompressionStream("deflate-raw");
      const stream = new Blob([compressedBytes]).stream().pipeThrough(ds);
      const arrayBuf = await new Response(stream).arrayBuffer();
      return new Blob([arrayBuf]);
    }
    throw new Error("未対応の圧縮方式です(method=" + match.compMethod + ")");
  }

  return { looksLikeZip, extractFirstMatch };
})();
