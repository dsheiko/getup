// Runs before `npm run dist`. electron-builder downloads Electron and its build tools,
// which fails behind a TLS-inspecting proxy unless Node trusts the system certificate store.
// build.ps1 sets this up; warn when the build was started some other way.

const nodeOptions = process.env.NODE_OPTIONS || "";
const hasSystemCa = nodeOptions.split(/\s+/).includes("--use-system-ca");
const hasExtraCa = Boolean(process.env.NODE_EXTRA_CA_CERTS);

if (!hasSystemCa && !hasExtraCa) {
  console.warn([
    "",
    "WARNING: Node is not set up to trust the system certificate store.",
    "Behind a TLS-inspecting proxy the build fails with \"self-signed certificate in certificate chain\".",
    "Build with .\\build.ps1 instead, or set NODE_OPTIONS=--use-system-ca first.",
    "",
  ].join("\n"));
}
