export type LinearExpr = Map<string, number>;

export function expr(): LinearExpr {
  return new Map();
}

export function addTerm(target: LinearExpr, name: string, coefficient: number): void {
  if (!coefficient) return;
  target.set(name, (target.get(name) ?? 0) + coefficient);
  if (!target.get(name)) target.delete(name);
}

export function scaleExpr(target: LinearExpr, factor: number): LinearExpr {
  const next = expr();
  for (const [name, coefficient] of target) addTerm(next, name, coefficient * factor);
  return next;
}

export function evaluate(target: LinearExpr, values: Record<string, number>): number {
  let total = 0;
  for (const [name, coefficient] of target) total += coefficient * (values[name] ?? 0);
  return total;
}

interface Variable {
  name: string;
  lb: number;
  ub: number;
  kind: "binary" | "integer" | "continuous";
}

interface Constraint {
  name: string;
  terms: [string, number][];
  sense: "<=" | ">=" | "=";
  rhs: number;
}

function formatNumber(value: number): string {
  if (Object.is(value, -0)) return "0";
  if (Number.isInteger(value)) return value.toString();
  return String(Math.round(value * 1_000_000) / 1_000_000);
}

function formatPieces(terms: [string, number][]): string[] {
  const visible = terms.filter(([, coefficient]) => coefficient !== 0);
  if (visible.length === 0) return ["1 zconst"];
  return visible.map(([name, coefficient], index) => {
    const magnitude = formatNumber(Math.abs(coefficient));
    if (index === 0) return coefficient < 0 ? `- ${magnitude} ${name}` : `${magnitude} ${name}`;
    return coefficient < 0 ? `- ${magnitude} ${name}` : `+ ${magnitude} ${name}`;
  });
}

function objectiveLines(terms: [string, number][]): string[] {
  const pieces = formatPieces(terms);
  return [` obj: ${pieces[0]}`, ...pieces.slice(1).map((piece) => `  ${piece}`)];
}

function constraintLines(name: string, terms: [string, number][], sense: "<=" | ">=" | "=", rhs: number): string[] {
  const pieces = formatPieces(terms);
  const tail = `${sense} ${formatNumber(rhs)}`;
  if (pieces.length === 1) return [` ${name}: ${pieces[0]} ${tail}`];
  return [
    ` ${name}: ${pieces[0]}`,
    ...pieces.slice(1, -1).map((piece) => `  ${piece}`),
    `  ${pieces[pieces.length - 1]} ${tail}`,
  ];
}

export class LpModel {
  private readonly variables = new Map<string, Variable>();
  private readonly constraints: Constraint[] = [];

  constructor() {
    this.addContinuous("zconst", 0, 0);
  }

  addBinary(name: string, lb = 0, ub = 1): void {
    this.variables.set(name, { name, lb, ub, kind: "binary" });
  }

  addInteger(name: string, lb: number, ub: number): void {
    this.variables.set(name, { name, lb, ub, kind: "integer" });
  }

  addContinuous(name: string, lb: number, ub: number): void {
    this.variables.set(name, { name, lb, ub, kind: "continuous" });
  }

  addConstraint(
    name: string,
    terms: Iterable<[string, number]>,
    sense: "<=" | ">=" | "=",
    rhs: number,
  ): void {
    const cleaned: [string, number][] = [];
    for (const [nameOfVariable, coefficient] of terms) {
      if (!coefficient) continue;
      cleaned.push([nameOfVariable, coefficient]);
    }
    this.constraints.push({ name, terms: cleaned, sense, rhs });
  }

  clone(): LpModel {
    const copy = new LpModel();
    copy.variables.clear();
    for (const variable of this.variables.values()) copy.variables.set(variable.name, { ...variable });
    copy.constraints.push(
      ...this.constraints.map((constraint) => ({ ...constraint, terms: [...constraint.terms] as [string, number][] })),
    );
    return copy;
  }

  counts(): { binaries: number; integers: number; continuous: number; constraints: number } {
    let binaries = 0;
    let integers = 0;
    let continuous = 0;
    for (const variable of this.variables.values()) {
      if (variable.kind === "binary") binaries += 1;
      else if (variable.kind === "integer") integers += 1;
      else continuous += 1;
    }
    return { binaries, integers, continuous, constraints: this.constraints.length };
  }

  serialize(objective: LinearExpr): string {
    const lines = ["Minimize", ...objectiveLines([...objective.entries()])];
    lines.push("Subject To");
    if (this.constraints.length === 0) lines.push(" c0: zconst = 0");
    for (const constraint of this.constraints) {
      lines.push(...constraintLines(constraint.name, constraint.terms, constraint.sense, constraint.rhs));
    }
    lines.push("Bounds");
    for (const variable of this.variables.values()) {
      lines.push(` ${formatNumber(variable.lb)} <= ${variable.name} <= ${formatNumber(variable.ub)}`);
    }
    const binaries = [...this.variables.values()].filter((variable) => variable.kind === "binary");
    const integers = [...this.variables.values()].filter((variable) => variable.kind === "integer");
    if (binaries.length > 0) {
      lines.push("Binary");
      for (const variable of binaries) lines.push(` ${variable.name}`);
    }
    if (integers.length > 0) {
      lines.push("Generals");
      for (const variable of integers) lines.push(` ${variable.name}`);
    }
    lines.push("End");
    return lines.join("\n");
  }
}

export function safeToken(value: string): string {
  const cleaned = value.replace(/[^A-Za-z0-9_]/g, "_");
  return /^[A-Za-z_]/.test(cleaned) ? cleaned : `v_${cleaned}`;
}
