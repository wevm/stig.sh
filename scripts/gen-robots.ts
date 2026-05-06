/** Generate public/robots.txt from VITE_BASE_URL. */

import { writeFileSync } from 'fs'

const baseUrl = process.env.VITE_BASE_URL ?? 'https://stig.sh'

writeFileSync(
  'public/robots.txt',
  `User-agent: *
Allow: /
Disallow: /og/
`,
)

console.log(`Generated public/robots.txt (${baseUrl})`)
