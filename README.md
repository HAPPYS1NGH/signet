This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Ledger & permissions demo

Walk through the flow in this order:

1. **Connect Ledger** — In the app, connect your Ledger and complete the wallet connection flow.
2. **Upgrade to EIP-7702** — In the UI, complete the upgrade so the account can use EIP-7702 delegation.
3. **Grant permission** — Use the Grant Permission flow in the dashboard. After granting, ensure your `.env` includes the values the agent scripts need (for example `PERMISSION_ID` from the grant, `SPENDER_PRIVATE_KEY` for the spender EOA, and `NEXT_PUBLIC_JAW_API_KEY`).

4. **Run the permissioned execution script** (spender executes within the granted limits; logs to the app):

   ```bash
   npx tsx scripts/executeWithPermission.ts
   ```

5. **Run the exceed-limit request** (simulates an agent asking to spend above its limit — requires human approval):

   ```bash
   npx tsx scripts/exceedLimitRequest.ts
   ```

6. **Approve on the dashboard** — Open the Agent Monitor (or pending approvals UI), review the request, and approve so the transfer is signed on Ledger and submitted.

For steps 4–5, keep the dev server running (`npm run dev`) unless you point `API_BASE` in `.env` at another deployment. Optional script env vars include `API_BASE`, and for `exceedLimitRequest.ts` you can set `RECIPIENT` and `AMOUNT_ETH` (use an amount above the permission spend limit to force the approval path).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
