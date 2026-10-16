import { StockFlowFrame } from '@/components/stockflow-frame';
import Image from 'next/image';
import {
  chatGPTSignInPath,
  getChatGPTUser,
} from './chatgpt-auth';
import { getStockFlowSession } from '@/lib/stockflow-session';
import { publicChatGPTSignInUrl, publicStaffSignInUrl, staffAuthEnabled, StaffSessionUnavailableError } from '@/lib/staff-auth';
import { StaffAccountSwitch, StaffSignIn, StaffSessionUnavailable } from '@/components/staff-sign-in';

export const dynamic = 'force-dynamic';

export default async function Home() {
  let user;
  try { user = await getChatGPTUser(); }
  catch (error) {
    if (error instanceof StaffSessionUnavailableError) return <StaffSessionUnavailable />;
    throw error;
  }

  if (!user) {
    if (staffAuthEnabled()) return <StaffSignIn resume chatGPTSignInUrl={publicChatGPTSignInUrl()} />;
    const staffSignInUrl = publicStaffSignInUrl();
    return (
      <main className="grid min-h-dvh place-items-center bg-sf-page px-5 text-sf-strong">
        <section className="w-full max-w-md rounded-3xl border border-sf-line-soft bg-white p-8 shadow-[0_18px_55px_rgba(9,47,54,0.12)]">
          <Image src="/suprabha-logo.png" alt="Suprabha Distributors" width={56} height={56} priority className="mb-6 size-14 object-contain" />
          <p className="mb-2 text-xs font-extrabold uppercase tracking-[0.14em] text-sf-accent">
            Suprabha Distributors
          </p>
          <h1 className="text-3xl font-bold tracking-tight">StockFlow</h1>
          <p className="mt-3 leading-6 text-sf-subtle">
            A private workspace for stock decisions and daily distribution
            operations.
          </p>
          <a
            href={chatGPTSignInPath('/')}
            target="_top"
            className="mt-7 flex min-h-12 w-full items-center justify-center rounded-xl bg-sf-ink px-5 font-semibold text-white transition hover:bg-sf-ink-hover focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-sf-mint"
          >
            Sign in with ChatGPT
          </a>
          {staffSignInUrl && <>
            <p className="mt-4 text-center text-sm text-sf-subtle">or use your staff account</p>
            <a href={staffSignInUrl} target="_top" className="mt-3 flex min-h-12 w-full items-center justify-center rounded-xl border border-sf-line px-5 font-semibold hover:bg-sf-accent-soft">
              Staff email / password
            </a>
          </>}
          <p className="mt-4 text-center text-xs text-sf-subtle">
            Access is limited to approved company accounts.
          </p>
        </section>
      </main>
    );
  }

  const session = await getStockFlowSession(user.email);
  if (!session) {
    return (
      <main className="grid min-h-dvh place-items-center bg-sf-page px-5 text-sf-strong">
        <section className="w-full max-w-md rounded-3xl border border-sf-warning-line bg-white p-8 shadow-[0_18px_55px_rgba(9,47,54,0.1)]">
          <Image src="/suprabha-logo.png" alt="Suprabha Distributors" width={48} height={48} priority className="mb-5 size-12 object-contain" />
          <p className="text-xs font-extrabold uppercase tracking-[0.14em] text-sf-warning">
            Access restricted
          </p>
          <h1 className="mt-2 text-2xl font-bold">This account is not approved</h1>
          <p className="mt-3 leading-6 text-sf-subtle">
            You signed in as {user.email}. Ask a StockFlow administrator to add
            this address.
          </p>
          {staffAuthEnabled() ? <StaffAccountSwitch /> : <>
          {/* The Sites dispatcher owns sign-out; this must remain a top-level browser navigation. */}
          {/* oxlint-disable-next-line next/no-html-link-for-pages */}
          <a
            href="/signout-with-chatgpt?return_to=/"
            target="_top"
            className="mt-7 inline-flex min-h-11 items-center justify-center rounded-xl border border-sf-line px-5 font-semibold text-sf-strong hover:bg-sf-accent-soft"
          >
            Use another account
          </a>
          </>}
        </section>
      </main>
    );
  }

  return <StockFlowFrame actorEmail={session.email} actorRole={session.role} actorRoles={session.roles} staffAuth={staffAuthEnabled()} staffEmailActionsEnabled={process.env.STOCKFLOW_AUTH_EMAIL_RESET_ENABLED === 'true'} />;
}
