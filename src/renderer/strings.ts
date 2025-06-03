export function splitStartsWith(text: string, prefix: string): { head: string, tail: string }|undefined {
  if (text.startsWith(prefix)) {
    const tail = text.slice(prefix.length);
    return { head: prefix, tail };
  }
}