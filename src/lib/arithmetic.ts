/**
 * A minimal, `eval`-free arithmetic evaluator for +, -, *, / and decimals — exactly what
 * Calculator.tsx's button-driven input can ever produce. Recursive-descent, standard
 * operator precedence (× and ÷ bind tighter than + and −).
 */
export function evaluateArithmetic(expression: string): number {
  let pos = 0;

  const peek = () => expression[pos];
  const isDigit = (c: string | undefined) => !!c && /[0-9.]/.test(c);

  function parseNumber(): number {
    let start = pos;
    while (isDigit(peek())) pos++;
    const token = expression.slice(start, pos);
    if (token.length === 0 || isNaN(Number(token))) {
      throw new Error('invalid number');
    }
    return Number(token);
  }

  function parseFactor(): number {
    if (peek() === '-') {
      pos++;
      return -parseFactor();
    }
    return parseNumber();
  }

  function parseTerm(): number {
    let value = parseFactor();
    while (peek() === '*' || peek() === '/') {
      const op = peek();
      pos++;
      const rhs = parseFactor();
      value = op === '*' ? value * rhs : value / rhs;
    }
    return value;
  }

  function parseExpr(): number {
    let value = parseTerm();
    while (peek() === '+' || peek() === '-') {
      const op = peek();
      pos++;
      const rhs = parseTerm();
      value = op === '+' ? value + rhs : value - rhs;
    }
    return value;
  }

  const result = parseExpr();
  if (pos !== expression.length) {
    throw new Error('unexpected trailing characters');
  }
  return result;
}
