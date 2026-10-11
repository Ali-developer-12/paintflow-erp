const { execFileSync } = require("node:child_process");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

function run(command, args) {
  execFileSync(command, args, { stdio: "inherit" });
}

function signatureDetails(appPath) {
  const result = spawnSync("codesign", ["-dv", "--verbose=2", appPath], {
    encoding: "utf8",
  });
  if (result.error) throw result.error;
  return `${result.stdout || ""}\n${result.stderr || ""}`;
}

function verifySignature(appPath) {
  const result = spawnSync("codesign", ["--verify", "--deep", "--strict", appPath], {
    encoding: "utf8",
  });
  if (result.error) throw result.error;
  return result;
}

module.exports = async (context) => {
  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  if (!fs.existsSync(appPath)) {
    throw new Error(`electron-builder did not create the expected app bundle: ${appPath}`);
  }

  let details = signatureDetails(appPath);
  const verification = verifySignature(appPath);
  if (verification.status !== 0) {
    if (details.includes("Authority=")) {
      throw new Error(
        `The signed app failed codesign verification: ${verification.stderr || verification.stdout}`,
      );
    }
    run("codesign", [
      "--force",
      "--deep",
      "--options",
      "runtime",
      "--entitlements",
      path.resolve("build/entitlements.mac.plist"),
      "--sign",
      "-",
      appPath,
    ]);
    details = signatureDetails(appPath);
    const adhocVerification = verifySignature(appPath);
    if (adhocVerification.status !== 0) {
      throw new Error(
        `The ad-hoc signed app failed codesign verification: ${adhocVerification.stderr || adhocVerification.stdout}`,
      );
    }
  }

  const notarizationCredentials = [
    "CSC_LINK",
    "CSC_KEY_PASSWORD",
    "APPLE_ID",
    "APPLE_APP_SPECIFIC_PASSWORD",
    "APPLE_TEAM_ID",
  ];
  const canNotarize = notarizationCredentials.every((name) => Boolean(process.env[name]));
  if (canNotarize) {
    if (!details.includes("Authority=")) {
      throw new Error(
        "Notarization credentials are set but the app is not signed with a Developer ID certificate",
      );
    }
    const notarizationZip = path.join(os.tmpdir(), `GSN-Paints-${process.pid}-${Date.now()}.zip`);
    try {
      run("ditto", ["-c", "-k", "--keepParent", appPath, notarizationZip]);
      run("xcrun", [
        "notarytool",
        "submit",
        notarizationZip,
        "--wait",
        "--apple-id",
        process.env.APPLE_ID,
        "--password",
        process.env.APPLE_APP_SPECIFIC_PASSWORD,
        "--team-id",
        process.env.APPLE_TEAM_ID,
      ]);
      run("xcrun", ["stapler", "staple", appPath]);
    } finally {
      fs.rmSync(notarizationZip, { force: true });
    }
  } else {
    console.log(
      "Notarization skipped: required Apple signing and notarization credentials are not all configured.",
    );
  }
};
