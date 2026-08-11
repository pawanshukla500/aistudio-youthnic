const { generateKeyPairSync } = require('crypto');
const fs = require('fs');

function generateAuthKeys() {
  console.log("Generating RSA keys...");
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'jwk' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
  });

  const jwks = {
    keys: [{
      ...publicKey,
      use: "sig",
      kid: "1"
    }]
  };

  const jwtPrivateKey = privateKey;
  const jwksString = JSON.stringify(jwks);

  let envFile = fs.readFileSync('.env.local', 'utf-8');
  
  if (!envFile.includes('JWT_PRIVATE_KEY')) {
    envFile += `\nJWT_PRIVATE_KEY="${jwtPrivateKey.replace(/\n/g, '\\n')}"\n`;
    envFile += `JWKS='${jwksString}'\n`;
    fs.writeFileSync('.env.local', envFile);
    console.log("Added keys to .env.local");
  } else {
    console.log("Keys already exist in .env.local");
  }
}

generateAuthKeys();
