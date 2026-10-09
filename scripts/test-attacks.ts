import { runAllTrustLabAttacks } from '../src/lib/trust-lab/attacks';

async function main() {
  console.log('\n===============================================================');
  console.log('  DISPUTE AUTOPILOT | TRUST LAB LIVE SECURITY ATTACK SUITE');
  console.log('  PayPal AI Hackathon 2026 - Threat Model & Policy Defense');
  console.log('===============================================================\n');
  console.log('Executing 6 automated penetration test vectors against live endpoints...\n');

  const attacks = await runAllTrustLabAttacks();

  console.log('-------------------------------------------------------------------------------------------------------------');
  console.log('| Vector | Attack Description                     | Type             | HTTP | Status  | Cryptographic Audit Ref |');
  console.log('-------------------------------------------------------------------------------------------------------------');

  for (let i = 0; i < attacks.length; i++) {
    const a = attacks[i];
    const vec = (`#${i + 1}`).padEnd(6);
    const desc = a.name.padEnd(38);
    const type = a.attack_type.padEnd(16);
    const http = String(a.http_status).padEnd(4);
    const status = (a.blocked ? 'BLOCKED' : 'BREACHED').padEnd(7);
    const ref = a.audit_ref.padEnd(23);

    console.log(`| ${vec} | ${desc} | ${type} | ${http} | ${status} | ${ref} |`);
  }
  console.log('-------------------------------------------------------------------------------------------------------------\n');

  const allBlocked = attacks.every((a) => a.blocked);
  if (allBlocked) {
    console.log('✓ ALL 6 ATTACKS SUCCESSFULLY BLOCKED: Zero unauthorized operations executed.\n');
  } else {
    console.error('✗ SECURITY BREACH: One or more attacks bypassed security policy!\n');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Trust Lab runner failed:', err);
  process.exit(1);
});
