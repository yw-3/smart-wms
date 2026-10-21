import { db } from './db.js';
import * as XLSX from 'xlsx';

// 读取上传的 Excel/CSV 为行数组（对象形式，空值补 ''）
// CSV：Buffer 按 UTF-8 解码并去 BOM；若出现乱码替换符则按 GBK 重解（Excel 中文版默认编码）
export function readSheetRows(file) {
  const isCsv = (file.originalname || '').toLowerCase().endsWith('.csv');
  let wb;
  try {
    if (isCsv) {
      let text = file.buffer.toString('utf8');
      if (text.includes('\uFFFD')) {
        try { text = new TextDecoder('gbk').decode(file.buffer); } catch { /* 保留 UTF-8 结果 */ }
      }
      if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
      wb = XLSX.read(text, { type: 'string' });
    } else {
      wb = XLSX.read(file.buffer, { type: 'buffer' });
    }
  } catch {
    throw new Error('文件解析失败：请确认是有效的 Excel(.xlsx/.xls) 或 CSV 文件');
  }
  const sheetName = wb.SheetNames[0];
  if (!sheetName) throw new Error('文件中没有可读取的工作表');
  return XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: '' });
}

// 操作日志：追加式存储，永久留痕，防篡改（只 insert，不 update/delete）
export async function logOperation(req, action, module, detail = '') {
  const u = req.user || {};
  try {
    await db.prepare(
      `INSERT INTO operation_logs (user_id, username, real_name, action, module, detail)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(u.sub ?? null, u.username ?? 'system', u.realName ?? '', action, module, detail);
  } catch (e) {
    console.error('写操作日志失败', e.message);
  }
}

// 统一异步包装，避免未捕获异常导致进程崩溃
export function wrap(handler) {
  return (req, res) => {
    Promise.resolve(handler(req, res)).catch((err) => {
      console.error('接口错误:', err);
      res.status(500).json({ error: err.message || '服务器内部错误' });
    });
  };
}
