import * as core from "@actions/core";
import { execSync } from "child_process";
import * as fs from "fs";
import { prepareEnv } from "./env";
import { Inputs } from "./inputs";

const POSTPROCESSING_REPLACEMENT_PATTERNS: [RegExp, string, string][] = [
  // Remove duplicated quotes marks, in case a template file explicitly
  // wraps a value in quotes when the value itself is already quoted.
  [
    /(^[A-Z_]+?=)"(".+")"$/gm,
    "$1$2",
    "Remove duplicate double quotes from the beginning and end of values",
  ],
  [
    /(^[A-Z_]+?=)'('.+')'$/gm,
    "$1$2",
    "Remove duplicate single quotes from the beginning and end of values",
  ],
  // Wrap values containing dollar signs in single quotes to prevent
  // unintended substitutions when the dotenv file is read by a shell.
  [
    /(^[A-Z_]+?=)([^\n"']+?[$][^\n"']+?)$/gm,
    "$1'$2'",
    "Wrap values containing dollar signs in single quotes",
  ],
  // Wrap values containing spaces and/or parentheses in double quotes
  // if they are not already wrapped in double/single quotes.
  [
    /(^[A-Z_]+?=)([^\n"']+?[ \(\)][^\n"]+?)$/gm,
    '$1"$2"',
    "Wrap values containing spaces and/or parentheses in double quotes",
  ],
  // Wrap JSON-like values (beginning with an opening curly bracket and
  // ending with a closing curly bracket) in single quotes because we
  // assume them to contain both spaces and double quotes.
  [
    /(^[A-Z_]+?=)({ *"[\s\S]+?})$/gm,
    "$1'$2'",
    "Wrap JSON-like values in single quotes",
  ],
];

interface Options extends Pick<Inputs, "outputPath" | "allowMissingVars"> {
  template: string;
}

export async function generateDotEnvFile({
  template,
  outputPath,
  allowMissingVars = false,
}: Options): Promise<boolean> {
  const { ok } = await prepareEnv({ template, allowMissingVars });
  if (!ok) {
    core.setFailed("Unable to prepare environment for dotenv file generation.");
    return false;
  }
  core.info("Generating dotenv file ...");
  execSync(`echo "${template}" | envsubst > ${outputPath}`, {
    env: process.env,
  });
  // Post-process the file to ensure that values with spaces are wrapped in quotes, etc.
  // so that the file can be sourced without errors.
  let processedFileContents = fs
    .readFileSync(outputPath, "utf-8")
    .split(/\n/)
    .map((line) => line.trim())
    .join("\n");
  for (const [
    pattern,
    replacement,
    description,
  ] of POSTPROCESSING_REPLACEMENT_PATTERNS) {
    core.info(`Running post-processor: "${description}"`);
    for (const match of processedFileContents.matchAll(pattern)) {
      const wrapperCharacter = replacement[replacement.length - 1];
      const obscuredValue = "*****";
      const wrappedObscuredValue = `${wrapperCharacter}${obscuredValue}${wrapperCharacter}`;
      core.warning(
        `${match[0].replace(match[2], obscuredValue)} --> ${match[0].replace(
          match[2],
          wrappedObscuredValue
        )}`
      );
    }
    processedFileContents = processedFileContents
      .replace(pattern, replacement)
      .trim();
  }
  if (!processedFileContents) {
    core.warning("The generated dotenv file is empty.");
  }
  fs.writeFileSync(outputPath, processedFileContents);
  return true;
}
