const blue = (...s: string[]) => `\x1b[34m${s.join(" ")}\x1b[0m`;

export default class Logger {
  static info(title: string, ...messages: any[]) {
    console.log(
      blue(new Date().toTimeString().substring(0, 8)),
      blue(title),
      ...messages
    );
  }
}
