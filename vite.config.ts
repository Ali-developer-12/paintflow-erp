import postcss from "postcss";
import { transform as transformCss } from "lightningcss";
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

function rgbChannels(value: string) {
  const hex = value.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    const hexValue = hex[1];
    if (!hexValue) return null;
    const digits =
      hexValue.length === 3 ? [...hexValue].map((digit) => digit + digit).join("") : hexValue;
    return {
      red: Number.parseInt(digits.slice(0, 2), 16),
      green: Number.parseInt(digits.slice(2, 4), 16),
      blue: Number.parseInt(digits.slice(4, 6), 16),
      alpha: 1,
    };
  }
  const rgb = value.match(
    /^rgba?\(\s*(\d+(?:\.\d+)?)[,\s]+(\d+(?:\.\d+)?)[,\s]+(\d+(?:\.\d+)?)(?:\s*[,/]\s*(\d*\.?\d+))?\s*\)$/i,
  );
  if (!rgb) return null;
  return {
    red: Number(rgb[1]),
    green: Number(rgb[2]),
    blue: Number(rgb[3]),
    alpha: rgb[4] === undefined ? 1 : Number(rgb[4]),
  };
}

function downlevelCss(css: string, filename: string) {
  const parsed = postcss.parse(css, { from: filename });
  parsed.walkAtRules("supports", (rule) => {
    if (/color:\s*lab\(/i.test(rule.params)) rule.remove();
  });
  const colorMixes = new Map<string, { token: string | null; percentage: number }>();
  let nextMixId = 0;
  parsed.walkDecls((decl) => {
    if (!decl.value.includes("color-mix(")) return;
    const mix = decl.value.match(
      /^color-mix\(in oklab,\s*(?:var\((--[\w-]+)\)|currentcolor)\s+([\d.]+)%,\s*transparent\)$/i,
    );
    if (!mix) throw new Error(`Unsupported Chromium CSS color mix in ${filename}: ${decl.value}`);
    const percentage = mix[2];
    if (!percentage)
      throw new Error(`Invalid Chromium CSS color mix in ${filename}: ${decl.value}`);
    const id = `--e0-cmix-${nextMixId++}`;
    colorMixes.set(id, {
      token: mix[1] ?? null,
      percentage: Number(percentage),
    });
    decl.value = `var(${id})`;
  });
  parsed.walkRules((rule) => {
    if (!rule.selector.trim()) rule.remove();
  });

  const transformed = transformCss({
    filename,
    code: Buffer.from(parsed.toString()),
    minify: true,
    targets: { chrome: 108 },
  }).code.toString();
  const root = postcss.parse(transformed, { from: filename });
  root.walkAtRules("supports", (rule) => {
    if (/color:\s*lab\(|color-mix\(in lab,/i.test(rule.params)) rule.remove();
  });

  const lightValues = new Map<string, ReturnType<typeof rgbChannels>>();
  const darkValues = new Map<string, ReturnType<typeof rgbChannels>>();
  const rootRules: postcss.Rule[] = [];
  const darkRules: postcss.Rule[] = [];
  const rulesToSplit: { rule: postcss.Rule; groups: string[][] }[] = [];
  root.walkRules((rule) => {
    const groups = new Map<string, string[]>();
    for (const selector of rule.selectors) {
      const opacityMatches = [...selector.matchAll(/\\\/(\d+(?:\.\d+)?)/g)];
      const opacity = opacityMatches[opacityMatches.length - 1]?.[1] ?? "";
      const selectors = groups.get(opacity) ?? [];
      selectors.push(selector);
      groups.set(opacity, selectors);
    }
    if (groups.size > 1) rulesToSplit.push({ rule, groups: [...groups.values()] });
  });
  for (const { rule, groups } of rulesToSplit) {
    const [firstGroup, ...remainingGroups] = groups;
    if (!firstGroup) continue;
    rule.selectors = firstGroup;
    for (const selectors of remainingGroups) {
      rule.cloneAfter({ selector: selectors.join(",") });
    }
  }

  root.walkRules((rule) => {
    const target =
      rule.selector === ":root"
        ? { values: lightValues, rules: rootRules }
        : rule.selector === ".dark"
          ? { values: darkValues, rules: darkRules }
          : null;
    if (!target) return;
    target.rules.push(rule);
    rule.walkDecls((decl) => {
      if (!decl.prop.startsWith("--") || target.values.has(decl.prop)) return;
      const color = rgbChannels(decl.value);
      if (color) target.values.set(decl.prop, color);
    });
  });

  if (!rootRules.length)
    throw new Error("Chromium CSS fallback generation could not find :root colors");
  if (!darkRules.length)
    throw new Error("Chromium CSS fallback generation could not find .dark colors");
  const rootColorRule = rootRules[rootRules.length - 1];
  const darkColorRule = darkRules[darkRules.length - 1];
  if (!rootColorRule || !darkColorRule) {
    throw new Error("Chromium CSS fallback generation could not find theme color rules");
  }

  const mixedTokens = new Map<string, Set<number>>();
  const fallbackDeclarations = new Map<
    postcss.Declaration,
    { token: string; percentage: number }
  >();
  const addMixedToken = (token: string, percentage: number) => {
    const percentages = mixedTokens.get(token) ?? new Set<number>();
    percentages.add(percentage);
    mixedTokens.set(token, percentages);
  };

  root.walkDecls((decl) => {
    const placeholder = decl.value.match(/^var\((--e0-cmix-\d+)\)$/);
    if (!placeholder) return;
    const placeholderId = placeholder[1];
    if (!placeholderId) throw new Error("Chromium CSS fallback placeholder has no identifier");
    const mix = colorMixes.get(placeholderId);
    if (!mix) throw new Error(`Chromium CSS color fallback is missing for ${placeholderId}`);
    if (mix.token) {
      addMixedToken(mix.token, mix.percentage);
      fallbackDeclarations.set(decl, { token: mix.token, percentage: mix.percentage });
    } else {
      decl.value = "currentColor";
      decl.parent?.append(postcss.decl({ prop: "opacity", value: "0.5" }));
    }
  });

  root.walkRules((rule) => {
    const opacityMatches = [...rule.selector.matchAll(/\\\/(\d+(?:\.\d+)?)/g)];
    const opacity = opacityMatches[opacityMatches.length - 1]?.[1];
    if (!opacity) return;
    const percentage = Number(opacity);
    if (percentage <= 0 || percentage > 100) return;
    rule.walkDecls((decl) => {
      if (
        !["color", "background-color", "border-color", "stroke", "--tw-ring-color"].includes(
          decl.prop,
        )
      ) {
        return;
      }
      const token = decl.value.match(/^var\((--[\w-]+)\)$/)?.[1];
      if (!token || token.startsWith("--e0-")) return;
      addMixedToken(token, percentage);
      fallbackDeclarations.set(decl, { token, percentage });
    });
  });

  for (const [token, percentages] of mixedTokens) {
    const light = lightValues.get(token);
    if (!light) throw new Error(`No Chromium 108 color fallback for ${token}`);
    const variableBase = `--e0-mix-${token.slice(2)}`;
    for (const percentage of percentages) {
      const alpha = (light.alpha * percentage) / 100;
      const variable = `${variableBase}-${percentage}`;
      rootColorRule.append(
        postcss.decl({
          prop: variable,
          value: `rgb(${light.red} ${light.green} ${light.blue} / ${alpha})`,
        }),
      );
      const dark = darkValues.get(token);
      if (dark) {
        const darkAlpha = (dark.alpha * percentage) / 100;
        darkColorRule.append(
          postcss.decl({
            prop: variable,
            value: `rgb(${dark.red} ${dark.green} ${dark.blue} / ${darkAlpha})`,
          }),
        );
      }
    }
  }

  for (const [decl, { token, percentage }] of fallbackDeclarations) {
    decl.value = `var(--e0-mix-${token.slice(2)}-${percentage})`;
  }

  const remainingColorFunctions = root.toString().match(/(?:color-mix|oklch|lab)\([^)]*\)/gi);
  if (remainingColorFunctions) {
    throw new Error(
      `Chromium 108 CSS still contains unsupported colors in ${filename}: ${remainingColorFunctions.slice(0, 5).join("; ")}`,
    );
  }
  return root.toString();
}

export default defineConfig({
  tanstackStart: { spa: { enabled: true, prerender: { outputPath: "/index" } } },
  nitro: false,
  vite: {
    build: {
      target: "chrome108",
      cssMinify: false,
    },
    plugins: [
      {
        name: "downlevel-css-for-chromium-108",
        generateBundle: {
          order: "post",
          handler(_options, bundle) {
            for (const asset of Object.values(bundle)) {
              if (asset.type !== "asset" || !asset.fileName.endsWith(".css")) continue;
              const css =
                typeof asset.source === "string"
                  ? asset.source
                  : Buffer.from(asset.source).toString("utf8");
              asset.source = downlevelCss(css, asset.fileName);
            }
          },
        },
      },
    ],
    environments: {
      client: { build: { outDir: "dist" } },
      ssr: { build: { outDir: ".output/server" } },
    },
  },
});
