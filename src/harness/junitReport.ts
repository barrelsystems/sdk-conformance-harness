/** Hand-rolled, not library-sourced -- the format is small and stable
 * enough that no renowned library for it is worth a dependency. */
export interface JUnitCase {
  readonly suiteName: string;
  readonly name: string;
  readonly passed: boolean;
  readonly failureMessage?: string;
}

/** `exactOptionalPropertyTypes` forbids an explicit `failureMessage: undefined`
 * -- this conditionally omits the key entirely on a pass, instead. */
export function toJUnitCase(options: {
  readonly suiteName: string;
  readonly name: string;
  readonly passed: boolean;
  readonly error: unknown;
}): JUnitCase {
  const { suiteName, name, passed, error } = options;

  return { suiteName, name, passed, ...(!passed && { failureMessage: String(error) }) };
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function renderJUnitXml(cases: ReadonlyArray<JUnitCase>): string {
  const bySuite = new Map<string, JUnitCase[]>();

  for (const testCase of cases) {
    const suite = bySuite.get(testCase.suiteName) ?? [];

    suite.push(testCase);
    bySuite.set(testCase.suiteName, suite);
  }

  const suitesXml = [...bySuite.entries()]
    .map(([suiteName, suiteCases]) => {
      const failureCount = suiteCases.filter((testCase) => !testCase.passed).length;
      const casesXml = suiteCases
        .map((testCase) => {
          const failure =
            testCase.passed || !testCase.failureMessage
              ? ""
              : `\n      <failure message="${escapeXml(testCase.failureMessage)}" />`;

          return `    <testcase name="${escapeXml(testCase.name)}" classname="${escapeXml(suiteName)}">${failure}\n    </testcase>`;
        })
        .join("\n");

      return `  <testsuite name="${escapeXml(suiteName)}" tests="${suiteCases.length}" failures="${failureCount}">\n${casesXml}\n  </testsuite>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>\n<testsuites>\n${suitesXml}\n</testsuites>\n`;
}
