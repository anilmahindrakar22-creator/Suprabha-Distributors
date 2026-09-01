import { StockFlowFrame } from '@/components/stockflow-frame';
import {
  chatGPTSignInPath,
  getChatGPTUser,
} from './chatgpt-auth';
import { getStockFlowSession } from '@/lib/stockflow-session';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const user = await getChatGPTUser();

  if (!user) {
    return (
      <main className="grid min-h-dvh place-items-center bg-[#f7f6f1] px-5 text-[#173239]">
        <section className="w-full max-w-md rounded-3xl border border-[#dce7e5] bg-white p-8 shadow-[0_18px_55px_rgba(9,47,54,0.12)]">
          <div className="mb-6 grid size-12 place-items-center rounded-2xl bg-[#64d4ad] text-xl font-black text-[#092f36]">
            S
          </div>
          <p className="mb-2 text-xs font-extrabold uppercase tracking-[0.14em] text-[#277b69]">
            Suprabha Distributors
          </p>
          <h1 className="text-3xl font-bold tracking-tight">StockFlow</h1>
          <p className="mt-3 leading-6 text-[#64787b]">
            A private workspace for stock decisions and daily distribution
            operations.
          </p>
          <a
            href={chatGPTSignInPath('/')}
            target="_top"
            className="mt-7 flex min-h-12 w-full items-center justify-center rounded-xl bg-[#092f36] px-5 font-semibold text-white transition hover:bg-[#0d4549] focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[#64d4ad]"
          >
            Sign in to StockFlow
          </a>
          <p className="mt-4 text-center text-xs text-[#718486]">
            Access is limited to approved company accounts.
          </p>
        </section>
      </main>
    );
  }

  const session = await getStockFlowSession(user.email);
  if (!session) {
    return (
      <main className="grid min-h-dvh place-items-center bg-[#f7f6f1] px-5 text-[#173239]">
        <section className="w-full max-w-md rounded-3xl border border-[#efd6a5] bg-white p-8 shadow-[0_18px_55px_rgba(9,47,54,0.1)]">
          <p className="text-xs font-extrabold uppercase tracking-[0.14em] text-[#9a6412]">
            Access restricted
          </p>
          <h1 className="mt-2 text-2xl font-bold">This account is not approved</h1>
          <p className="mt-3 leading-6 text-[#64787b]">
            You signed in as {user.email}. Ask a StockFlow administrator to add
            this address.
          </p>
          {/* The Sites dispatcher owns sign-out; this must remain a top-level browser navigation. */}
          {/* oxlint-disable-next-line next/no-html-link-for-pages */}
          <a
            href="/signout-with-chatgpt?return_to=/"
            target="_top"
            className="mt-7 inline-flex min-h-11 items-center justify-center rounded-xl border border-[#cfdedc] px-5 font-semibold text-[#173239] hover:bg-[#eef6f3]"
          >
            Use another account
          </a>
        </section>
      </main>
    );
  }

  return <StockFlowFrame actorRole={session.role} />;
}
