# Builds the Windows installer (dist\Getup Setup <version>.exe).
# --use-system-ca: Node trusts the Windows certificate store, so downloads work behind a TLS-inspecting proxy.
$previous = $env:NODE_OPTIONS
$env:NODE_OPTIONS = "--use-system-ca"
try {
    npm run dist
} finally {
    $env:NODE_OPTIONS = $previous # environment changes outlive the script in this terminal
}
exit $LASTEXITCODE
