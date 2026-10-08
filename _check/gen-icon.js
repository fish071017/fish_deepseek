/* 程序化生成 PWA 图标（纯 Node，零依赖）：PNG 编码 + CRC32 + zlib */
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

/* ---------- 最小 PNG 编码器 ---------- */
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for(let n = 0; n < 256; n++){
    let c = n;
    for(let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
})();
function crc32(buf){
  let c = 0xFFFFFFFF;
  for(let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function chunk(type, data){
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td), 0);
  return Buffer.concat([len, td, crc]);
}
function encodePNG(w, h, rgba){
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for(let y = 0; y < h; y++){
    raw[y * (w * 4 + 1)] = 0;                       // filter: none
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;   // 8bit RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

/* ---------- 24x24 像素图标设计（'.' 透明） ---------- */
const PAL = {
  ".": null,
  "K": [11, 11, 20],        // 深底
  "P": [255, 77, 109],      // 粉
  "C": [77, 210, 255],      // 青
  "Y": [255, 217, 61],      // 黄
  "G": [124, 255, 178],     // 薄荷
  "W": [232, 232, 240]      // 白
};
/* 四色风车 + 中心白点，硬边像素 */
const ART = [
  "........................",
  "......KKKKKKKKKKKK......",
  "....KKKKKKKKKKKKKKKK....",
  "...KKKKKKKKKKKKKKKKKK...",
  "..KKKKKKKKKKKKKKKKKKKK..",
  "..KKKKPPKKKKKKKKCCKKKK..",
  ".KKKKPPPPKKKKKKCCCCKKKK.",
  ".KKKPPPPPPKKKKCCCCCCKKK.",
  ".KKPPPPPPPPKKCCCCCCCCKK.",
  ".KKPPPPPPPPPKCCCCCCCCKK.",
  ".KKKPPPPPPPPKCCCCCCCCKK.",
  ".KKKKPPPPPPPKCCCCCCCKKK.",
  ".KKKKKPPPPPPKCCCCCCKKKK.",
  ".KKKKKKPPPPPKKCCCCKKKKK.",
  ".KKKKKKKKPPPKKKCCKKKKKK.",
  ".KKKKKKKKKPPKKKKKKKKKKK.",
  ".KKKKKKKKKKKKKKKKKKKKKK.",
  ".KKKKKKKKKYYKKKKKKKKKKK.",
  ".KKKKKKKKYYYYKKKKKKKKKK.",
  "..KKKKKKKKYYKKKKKKKKKK..",
  "..KKKKKKKKKKKKKKKKKKKK..",
  "...KKKKKKKKWWKKKKKKKK...",
  "....KKKKKKKWWKKKKKKK....",
  "......KKKKKKKKKKKK......"
];
/* 上面手排容易出错，改用程序绘制更可靠 */
function drawIcon(size){
  const rgba = Buffer.alloc(size * size * 4);
  const S = 24;                          // 逻辑像素
  const cell = size / S;
  const put = (x, y, col) => {
    if(!col) return;
    const x0 = Math.round(x * cell), y0 = Math.round(y * cell);
    const x1 = Math.round((x + 1) * cell), y1 = Math.round((y + 1) * cell);
    for(let yy = y0; yy < y1; yy++){
      if(yy < 0 || yy >= size) continue;
      for(let xx = x0; xx < x1; xx++){
        if(xx < 0 || xx >= size) continue;
        const i = (yy * size + xx) * 4;
        rgba[i] = col[0]; rgba[i+1] = col[1]; rgba[i+2] = col[2]; rgba[i+3] = col[3] === undefined ? 255 : col[3];
      }
    }
  };
  const R = (x, y, w, h, col) => { for(let j = 0; j < h; j++) for(let i = 0; i < w; i++) put(x + i, y + j, col); };

  const BG = [11, 11, 20];
  const PINK = [255, 77, 109], CYAN = [77, 210, 255], YELLOW = [255, 217, 61], MINT = [124, 255, 178];
  const LINE = [58, 58, 92];
  const WHITE = [232, 232, 240];

  /* 背景：深色圆角方块（像素圆角） */
  R(0, 0, S, S, BG);
  const corner = [[0,0],[1,0],[2,0],[0,1],[1,1],[0,2],
                  [S-1,0],[S-2,0],[S-3,0],[S-1,1],[S-2,1],[S-1,2],
                  [0,S-1],[1,S-1],[2,S-1],[0,S-2],[1,S-2],[0,S-3],
                  [S-1,S-1],[S-2,S-1],[S-3,S-1],[S-1,S-2],[S-2,S-2],[S-1,S-3]];
  for(const [x, y] of corner) put(x, y, [0,0,0,0]);

  /* 外框 */
  for(let i = 2; i < S - 2; i++){ put(i, 2, LINE); put(i, S - 3, LINE); put(2, i, LINE); put(S - 3, i, LINE); }

  /* 中心十字（街机感） */
  R(11, 4, 2, 16, LINE);
  R(4, 11, 16, 2, LINE);

  /* 四色像素块，构成风车 */
  R(5, 5, 5, 5, PINK);     /* 左上 粉 */
  R(5, 6, 4, 3, [255, 130, 155]);   /* 高光 */

  R(14, 5, 5, 5, CYAN);    /* 右上 青 */
  R(15, 6, 3, 3, [160, 235, 255]);

  R(5, 14, 5, 5, YELLOW);  /* 左下 黄 */
  R(6, 15, 3, 3, [255, 240, 150]);

  R(14, 14, 5, 5, MINT);   /* 右下 薄荷 */
  R(15, 15, 3, 3, [190, 255, 220]);

  /* 中心白点 */
  R(11, 11, 2, 2, WHITE);

  return rgba;
}

const outDir = path.join(__dirname, "..");
for(const size of [192, 512]){
  const buf = encodePNG(size, size, drawIcon(size));
  fs.writeFileSync(path.join(outDir, "icon-" + size + ".png"), buf);
  console.log("已生成 icon-" + size + ".png  (" + buf.length + " bytes)");
}

/* ---- favicon.ico：内嵌 32x32 PNG（Vista 以后的 ICO 支持这种写法） ---- */
{
  const png = encodePNG(32, 32, drawIcon(32));
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);      // reserved
  header.writeUInt16LE(1, 2);      // type: icon
  header.writeUInt16LE(1, 4);      // count
  const entry = Buffer.alloc(16);
  entry[0] = 32;                   // width
  entry[1] = 32;                   // height
  entry[2] = 0;                    // palette
  entry[3] = 0;                    // reserved
  entry.writeUInt16LE(1, 4);       // color planes
  entry.writeUInt16LE(32, 6);      // bits per pixel
  entry.writeUInt32LE(png.length, 8);
  entry.writeUInt32LE(6 + 16, 12); // offset
  const ico = Buffer.concat([header, entry, png]);
  fs.writeFileSync(path.join(outDir, "favicon.ico"), ico);
  console.log("已生成 favicon.ico  (" + ico.length + " bytes)");
}
