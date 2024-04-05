export const blueTime = (...s: string[]) =>
  `\x1b[34m${new Date().toTimeString().substring(0, 8)} ${s.join(" ")}\x1b[0m`;

export const blue = (...s: string[]) => `\x1b[34m${s.join(" ")}\x1b[0m`;

export const logMessage = (title: string, ...messages: any[]) =>
  console.log(blueTime(title), ...messages);
