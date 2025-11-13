/**
 * Generate self-signed SSL certificate for local HTTPS development
 * Run: node scripts/generate-cert.js
 */

import fs from 'fs';
import { execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const certDir = path.join(projectRoot, 'cert');

// Create cert directory if it doesn't exist
if (!fs.existsSync(certDir)) {
  fs.mkdirSync(certDir, { recursive: true });
}

// Helper to check if a CLI tool exists
function hasCommand(cmd) {
  try {
    execSync(`${cmd} --version`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const mkcertAvailable = hasCommand('mkcert');
const opensslAvailable = hasCommand('openssl');

if (mkcertAvailable) {
  try {
    execSync('mkcert -install', { stdio: 'inherit' });
    execSync(
      `mkcert -key-file "${path.join(certDir, 'server.key')}" -cert-file "${path.join(certDir, 'server.cert')}" localhost 127.0.0.1 ::1`,
      { stdio: 'inherit' }
    );
    console.log('✅ SSL certificates generated successfully using mkcert (locally trusted)');
  } catch (err) {
    console.error('❌ Failed to generate certificates with mkcert:', err.message);
    process.exit(1);
  }
} else if (opensslAvailable) {
  // Use OpenSSL if available (more standard)
  try {
    const keyPath = path.join(certDir, 'server.key');
    const certPath = path.join(certDir, 'server.cert');
    try {
      execSync(
        `openssl req -x509 -nodes -newkey rsa:2048 -keyout "${keyPath}" -out "${certPath}" -days 365 -subj "/C=IN/ST=Punjab/L=Fatehgarh Sahib/O=ScreenX/CN=localhost" -addext "subjectAltName=DNS:localhost,IP:127.0.0.1,IP:::1"`,
        { stdio: 'inherit' }
      );
    } catch {
      // Fallback using config file to inject SAN if -addext unsupported
      const cfg = `
[req]
distinguished_name = req_distinguished_name
req_extensions     = v3_req
x509_extensions    = v3_req
prompt = no

[req_distinguished_name]
C = IN
ST = Punjab
L = Fatehgarh Sahib
O = ScreenX
CN = localhost

[v3_req]
subjectAltName = @alt_names
keyUsage = critical, digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth

[alt_names]
DNS.1 = localhost
IP.1 = 127.0.0.1
IP.2 = ::1
`.trim();
      const cfgPath = path.join(certDir, 'openssl-local.cnf');
      fs.writeFileSync(cfgPath, cfg, 'utf8');
      execSync(
        `openssl req -x509 -nodes -newkey rsa:2048 -keyout "${keyPath}" -out "${certPath}" -days 365 -config "${cfgPath}"`,
        { stdio: 'inherit' }
      );
    }
    console.log('✅ SSL certificates generated successfully using OpenSSL');
  } catch (err) {
    console.error('❌ Failed to generate certificates with OpenSSL:', err.message);
    process.exit(1);
  }
} else {
  // Fallback: Use Node.js crypto (simpler but less standard)
  console.log('⚠️  Using Node.js crypto fallback. For production, use mkcert/OpenSSL or a trusted CA.');
  
  // For now, we'll create a simple script that the user can run
  // or we can use a package like 'selfsigned'
  console.log('\n📝 To generate trusted certificates, please:');
  console.log('   1. Install mkcert: https://github.com/FiloSottile/mkcert');
  console.log('   2. Or install OpenSSL: https://slproweb.com/products/Win32OpenSSL.html\n');
  
  // Try to use selfsigned if available (CommonJS module)
  try {
    // Use createRequire for CommonJS modules in ESM
    const { createRequire } = await import('module');
    const require = createRequire(import.meta.url);
    const selfsigned = require('selfsigned');
    
    const attrs = [{ name: 'commonName', value: 'localhost' }];
    const pems = selfsigned.generate(attrs, {
      days: 365,
      extensions: [
        { name: 'basicConstraints', cA: true },
        { name: 'keyUsage', keyCertSign: true, digitalSignature: true, keyEncipherment: true },
        { name: 'extKeyUsage', serverAuth: true, clientAuth: true },
        {
          name: 'subjectAltName',
          altNames: [
            { type: 2, value: 'localhost' }, // DNS
            { type: 7, ip: '127.0.0.1' },     // IPv4
            { type: 7, ip: '::1' }            // IPv6
          ]
        }
      ]
    });
    
    fs.writeFileSync(path.join(certDir, 'server.key'), pems.private);
    fs.writeFileSync(path.join(certDir, 'server.cert'), pems.cert);
    
    console.log('✅ SSL certificates generated successfully using selfsigned package');
  } catch (err) {
    console.error('❌ Failed to generate certificates:', err.message);
    console.log('\n📝 Alternative: Install OpenSSL from:');
    console.log('   https://slproweb.com/products/Win32OpenSSL.html');
    console.log('   Then run: openssl req -nodes -new -x509 -keyout cert/server.key -out cert/server.cert -days 365 -subj "/C=IN/ST=Punjab/L=Fatehgarh Sahib/O=ScreenX/CN=localhost"');
    process.exit(1);
  }
}

console.log(`\n📁 Certificates saved to: ${certDir}`);
console.log('   - server.key (private key)');
console.log('   - server.cert (certificate)');
console.log('\nℹ️  Trust options:');
console.log('   - Best: use mkcert (already trusted).');
console.log('   - Windows: import server.cert into "Trusted Root Certification Authorities" (Local Machine).');
console.log('   - macOS: add to Keychain Access and set to Always Trust.\n');

