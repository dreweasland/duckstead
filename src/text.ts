// Tiny shared text formatters.

// "3 eggs", "1 egg".
export function plural(n: number, word: string, suffix = 's'): string {
  return `${n} ${word}${n === 1 ? '' : suffix}`;
}

// "1st", "2nd", "3rd", "4th" — with the %100 guard so 11..13 read "11th",
// not "11st".
export function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}
