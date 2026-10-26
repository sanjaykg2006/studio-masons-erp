# How changes reach the live ERP

Every change goes to the **test ERP** first. Someone tries it there, and only then
is it sent to the **live ERP** that staff use.

| | Test ERP | Live ERP |
|---|---|---|
| Web address | https://studio-masons-erp-git-staging-sanjaykg1302-1727s-projects.vercel.app | https://studio-masons-erp.vercel.app |
| Data | Fake people, fake projects, fake money | Real |
| Who uses it | Whoever is checking a change | Everyone |

## Trying a change on the test ERP

1. Open the test web address above.
2. Sign in as one of the test people. They all share one password (Sanjay has it):

   | Login | Who they are |
   |---|---|
   | admin@example.com | Administrator (full access) |
   | md@example.com | Managing Director (full access) |
   | director@example.com | Director, and Project Director on every project |
   | cofounder@example.com | Co-Founder |
   | financehead@example.com | Finance Head on every project (Finance lead) |
   | accountshead@example.com | Accounts Head on every project (gives PO "Finance review") |
   | accounts@example.com | Accounts team |
   | buyer@example.com | Procurement Manager on every project (Procurement lead) |
   | pm@example.com | Project Manager on both demo projects |
   | site@example.com | Site Engineer on Green Meadows Villa only |
   | designer@example.com | Designer on every project (Design lead) |
   | staff@example.com | Staff, with no special access |

3. Do what the change is about, for example raise a PO as the buyer, then approve it
   as the Accounts Head and the Director. Use a private/incognito window to be
   two people at once.

The demo data has two projects: **Green Meadows Villa** and **Lakeside Office
Fit-out**. PO-002 is waiting for the Accounts Head, and a Lakeside intent is
waiting for the Project Director.

## Going live

When a change is ready, a **pull request** called "Release to live" appears on
GitHub: https://github.com/sanjaykg2006/studio-masons-erp/pulls

1. Open it. The green ticks mean every automatic check passed. GitHub won't allow
   the next step until they do.
2. Click **Merge pull request**, then **Confirm merge**.
3. That's it. Within a few minutes GitHub updates the live **database first**, then
   the live **website**. Progress is shown under the **Actions** tab, where a red
   cross means something stopped and nothing half-finished went out.

## Emergencies

If the live ERP is broken right now and can't wait for the test ERP, Sanjay can
allow an urgent fix to go straight to live (it's always asked first). It's then
copied back to the test ERP so the two stay in step.

## Keeping the test ERP like live

The test ERP copies the live **setup** (job titles, permissions, departments,
approval steps, templates), but never its people or business data. After
changing the setup on live, re-copy it (Sanjay or Claude runs these on Sanjay's
computer):

- `npm run test-env:copy-setup`: copy the live setup into the test ERP
- `npm run test-env:seed`: refresh the fake people and demo projects
