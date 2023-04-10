import * as core from "@actions/core";
import { execSync } from "child_process";
import * as fs from "fs";
import { nanoid } from "nanoid";
import path from "path";
import { getInputs, Inputs } from "./inputs";

const STATE_KEY = "DEPLOY_DOCKER_SSH";

async function run(): Promise<void> {
  // Verify workspace structure.
  const GITHUB_WORKSPACE = process.env.GITHUB_WORKSPACE;
  if (!GITHUB_WORKSPACE) {
    core.setFailed("GITHUB_WORKSPACE is not set.");
    return;
  } else if (!fs.existsSync(GITHUB_WORKSPACE)) {
    core.setFailed(`${GITHUB_WORKSPACE} does not exist.`);
    return;
  }

  // Ensure the home directory exists.
  const homeDir = process.env.HOME || path.resolve("~");
  if (!homeDir) {
    core.setFailed("HOME is not set.");
    return;
  } else if (!fs.existsSync(homeDir)) {
    core.setFailed(`Home directory (${homeDir}) does not exist.`);
    return;
  }
  core.info(`Home directory: ${homeDir}`);

  const sshDir = path.join(homeDir, ".ssh");
  // Ensure the SSH directory exists.
  fs.mkdirSync(sshDir, {
    recursive: true,
    mode: 0o700,
  });
  core.info(`SSH directory: ${sshDir}`);

  // Read inputs.
  const inputs: Inputs = await getInputs();

  // Set known hosts.
  const knownHostsFilepath = path.join(sshDir, "known_hosts");
  execInRealTime(`touch ${knownHostsFilepath}`);
  const githubHostsData = execSync(`ssh-keyscan github.com`).toString();
  fs.appendFileSync(knownHostsFilepath, githubHostsData);
  const remoteServerHostsData = execSync(
    `ssh-keyscan -p ${inputs.sshPort} -H ${inputs.host}`
  ).toString();
  fs.appendFileSync(knownHostsFilepath, remoteServerHostsData);

  // Start SSH agent.
  const output = execSync("ssh-agent").toString();
  // Extract and export environment variables from the ssh-agent output.
  for (const line of output.split("\n")) {
    const matches = /^(SSH_AUTH_SOCK|SSH_AGENT_PID)=(.*); export \1/.exec(line);
    if (matches && matches.length > 0) {
      // This will also set process.env accordingly, so changes take effect for this script
      core.exportVariable(matches[1], matches[2]);
      core.info(`${matches[1]}=${matches[2]}`);
    }
  }

  // Install the private key.
  execInRealTime(`ssh-add - <<< "${inputs.sshPrivateKey}"`);

  // Set private key.
  // const keyFilepath = path.join(sshDir, KEY_NAME);
  // fs.writeFileSync(keyFilepath, inputs.sshPrivateKey, { flag: "wx" });

  // Set permissions on the home directory.
  execInRealTime(`chmod og-rw ${homeDir}`);

  const sshPartial = `ssh -o StrictHostKeyChecking=no -p "${inputs.sshPort}"`;

  // Confirm able to connect.
  core.info("Checking connection...");
  let successMessage = "OK";
  const checkOutput = execSync(
    `${sshPartial} -o BatchMode=yes -o ConnectTimeout=5 ${inputs.user}@${inputs.host} echo "${successMessage}"`
  )
    .toString()
    .trim();
  core.info(`Result: ${checkOutput}`);

  // Confirm the target directory exists on the server.
  core.info("\nConfirming target directory exists on remote server...");
  successMessage = "Confirmed target directory exists.";
  const targetDirCheckOutput = execSync(
    `if ${sshPartial} ${inputs.user}@${inputs.host} "[ -d ${inputs.targetDir} ]"; 
    then echo "${successMessage}"; 
    else echo "Target directory ${inputs.targetDir} does not exist."; fi`
  )
    .toString()
    .trim();
  if (!targetDirCheckOutput.includes(successMessage)) {
    core.setFailed(targetDirCheckOutput);
    return;
  }

  if (inputs.files) {
    // Generate a temporary directory to hold only the deployable files.
    const distDirPath = path.join(GITHUB_WORKSPACE, `tmp-${nanoid()}`);
    fs.mkdirSync(distDirPath, { recursive: true });

    // Enter the source directory.
    const sourceDir = path.resolve(GITHUB_WORKSPACE, inputs.sourceDir);
    if (!fs.existsSync(sourceDir)) {
      core.setFailed(`${sourceDir} does not exist.`);
      return;
    }
    process.chdir(sourceDir);

    // Copy the deployable files from the source directory to the temporary directory.
    const relativeFilepaths = inputs.files.split(/[\s\n]+/);
    core.info(`\nTo be transported:\n${relativeFilepaths.join("\n")}`);
    for (const filepath of relativeFilepaths) {
      if (!fs.existsSync(filepath)) {
        core.setFailed(`${filepath} does not exist.`);
        return;
      }
      const destDir = path.join(distDirPath, path.dirname(filepath));
      fs.mkdirSync(destDir, { recursive: true });
      execInRealTime(`cp -r ${filepath} ${destDir}`);
    }
    core.info(`\nPrepared distribution directory with the following contents:`);
    execInRealTime(`ls -a ${distDirPath}`);

    // Sync the temporary directory to the target directory on the server.
    core.info(
      `\nSyncing distribution directory to ${inputs.host}:${inputs.targetDir} ...`
    );
    execInRealTime(
      `rsync -rPv -e "${sshPartial}" "${distDirPath}/" "${inputs.user}@${inputs.host}:${inputs.targetDir}"`
    );
  }

  // Execute the remote command.
  core.info(`\nStarting SSH connection with ${inputs.host} ...`);
  const command = `cd '${inputs.targetDir}' && ${inputs.command}`;
  core.info(command);
  try {
    execInRealTime(
      `${sshPartial} "${inputs.user}@${inputs.host}" "${command}"`
    );
  } catch (err) {
    core.setFailed(err instanceof Error ? err.message : `${err}`);
  }
}

if (typeof process.env[`STATE_${STATE_KEY}`] === "undefined") {
  core.saveState(STATE_KEY, "true");
  run();
} else {
  try {
    // Kill the SSH agent.
    execSync("ssh-agent -k");
  } catch (error) {
    core.info(String(error));
  }
}

function execInRealTime(
  ...args: Parameters<typeof execSync>
): ReturnType<typeof execSync> {
  const [command, options] = args;
  return execSync(command, {
    shell: "/bin/bash",
    stdio: "inherit",
    ...(options ?? {}),
  });
}
