type Operator = "+" | "-" | "*" | "/" | "%" | "^";

type Token =
  | { kind: "number"; value: number }
  | { kind: "operator"; value: Operator }
  | { kind: "left_parenthesis" }
  | { kind: "right_parenthesis" };

const number_pattern = /^(?:(?:\d+(?:\.\d*)?)|(?:\.\d+))(?:[eE][+-]?\d+)?/;
const max_expression_length = 200;
const max_token_count = 100;

function tokenize(expression: string): Token[] {

  if (expression.length > max_expression_length) {
    throw new Error("Expression is too long.");
  }

  const tokens: Token[] = [];
  let cursor = 0;

  while (cursor < expression.length) {
    const character = expression[cursor];

    if (character === undefined) {
      break;
    }

    if (/\s/.test(character)) {
      cursor += 1;
      continue;
    }

    const number_match = number_pattern.exec(expression.slice(cursor));
    const number_text = number_match?.[0];

    if (number_text !== undefined) {
      const value = Number(number_text);

      if (!Number.isFinite(value)) {
        throw new Error("Number is too large.");
      }

      tokens.push({ kind: "number", value });
      cursor += number_text.length;
    } else if (character === "(") {
      tokens.push({ kind: "left_parenthesis" });
      cursor += 1;
    } else if (character === ")") {
      tokens.push({ kind: "right_parenthesis" });
      cursor += 1;
    } else if (
      character === "+" ||
      character === "-" ||
      character === "*" ||
      character === "/" ||
      character === "%" ||
      character === "^"
    ) {
      tokens.push({ kind: "operator", value: character });
      cursor += 1;
    } else {
      throw new Error("Use only numbers, parentheses, and + - * / % ^.");
    }

    if (tokens.length > max_token_count) {
      throw new Error("Expression has too many parts.");
    }
  }

  return tokens;

}

export function evaluate_expression(expression: string): number {

  const tokens = tokenize(expression);

  if (tokens.length === 0) {
    throw new Error("Enter an expression first.");
  }

  let token_index = 0;

  function parse_primary(): number {

    const token = tokens[token_index];

    if (token?.kind === "number") {
      token_index += 1;
      return token.value;
    }

    if (token?.kind === "left_parenthesis") {
      token_index += 1;
      const value = parse_expression();

      if (tokens[token_index]?.kind !== "right_parenthesis") {
        throw new Error("A closing parenthesis is missing.");
      }

      token_index += 1;
      return value;
    }

    throw new Error("That expression doesn't look right.");

  }

  function parse_power(): number {

    const base = parse_primary();
    const token = tokens[token_index];

    if (token?.kind !== "operator" || token.value !== "^") {
      return base;
    }

    token_index += 1;
    return base ** parse_unary();

  }

  function parse_unary(): number {

    const token = tokens[token_index];

    if (token?.kind === "operator" && (token.value === "+" || token.value === "-")) {
      token_index += 1;
      const value = parse_unary();
      return token.value === "-" ? -value : value;
    }

    return parse_power();

  }

  function parse_term(): number {

    let value = parse_unary();

    while (true) {
      const token = tokens[token_index];

      if (
        token?.kind !== "operator" ||
        (token.value !== "*" && token.value !== "/" && token.value !== "%")
      ) {
        return value;
      }

      token_index += 1;
      const right_value = parse_unary();

      if ((token.value === "/" || token.value === "%") && right_value === 0) {
        throw new Error("Division by zero isn't allowed.");
      }

      if (token.value === "*") {
        value *= right_value;
      } else if (token.value === "/") {
        value /= right_value;
      } else {
        value %= right_value;
      }
    }

  }

  function parse_expression(): number {

    let value = parse_term();

    while (true) {
      const token = tokens[token_index];

      if (token?.kind !== "operator" || (token.value !== "+" && token.value !== "-")) {
        return value;
      }

      token_index += 1;
      const right_value = parse_term();
      value = token.value === "+" ? value + right_value : value - right_value;
    }

  }

  const result = parse_expression();

  if (token_index !== tokens.length) {
    throw new Error("That expression doesn't look right.");
  }

  if (!Number.isFinite(result)) {
    throw new Error("The result is too large to calculate.");
  }

  return result;

}
