import fs from "fs";

type EnvOptions = {
  filename?: string;
};

// The following code is adapted from the "dotenv" npm package:
// https://www.npmjs.com/package/dotenv
export default function env({ filename }: EnvOptions = { filename: ".env" }) {
  const filepath = `${process.cwd()}\\${filename}`;
  if (!fs.existsSync(filepath) || !fs.statSync(filepath).isFile()) return;
  const LINE =
    /(?:^|^)\s*(?:export\s+)?([\w.-]+)(?:\s*=\s*?|:\s+?)(\s*'(?:\\'|[^'])*'|\s*"(?:\\"|[^"])*"|\s*`(?:\\`|[^`])*`|[^#\r\n]+)?\s*(?:#.*)?(?:$|$)/gm;
  const src = fs
    .readFileSync(".env")
    .toString()
    .replace(/\r\n?/gm, "\n")
    .toString();
  let match;
  while ((match = LINE.exec(src)) != null) {
    const key = match[1];
    let value = (match[2] || "").trim();
    const maybeQuote = value[0];
    value = value.replace(/^(['"`])([\s\S]*)\1$/gm, "$2");
    if (maybeQuote === '"')
      value = value.replace(/\\n/g, "\n").replace(/\\r/g, "\r");
    process.env[key] = value;
  }
}
