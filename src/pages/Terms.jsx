import { Link } from 'react-router-dom';
import { HardHat } from 'lucide-react';

function Section({ title, children }) {
  return (
    <section>
      <h2 className="text-lg font-semibold text-foreground mb-3 mt-8">{title}</h2>
      <div className="space-y-3 text-sm text-muted-foreground leading-relaxed">{children}</div>
    </section>
  );
}

function Ul({ items }) {
  return (
    <ul className="list-disc list-inside space-y-1 pl-2">
      {items.map((item, i) => <li key={i}>{item}</li>)}
    </ul>
  );
}

export default function Terms() {
  return (
    <div className="min-h-screen bg-background flex flex-col">

      {/* Nav */}
      <header className="border-b border-border bg-background sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
              <HardHat className="w-4 h-4 text-primary-foreground" />
            </div>
            <span className="font-bold text-foreground">ConstructIQ</span>
          </Link>
          <Link to="/login" className="text-sm text-primary hover:underline">Sign In</Link>
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 max-w-3xl mx-auto w-full px-6 py-12">

        <div className="mb-8 pb-6 border-b border-border">
          <h1 className="text-3xl font-bold text-foreground mb-2">Terms of Use</h1>
          <p className="text-sm text-muted-foreground">Last updated: 30 June 2026</p>
        </div>

        <div className="text-sm text-muted-foreground leading-relaxed mb-6">
          These Terms of Use ("Terms") govern your access to and use of ConstructIQ, a construction
          project management platform operated by Total Home Solutions HB LTD ("we", "us", "our").
          By accessing or using ConstructIQ, you agree to be bound by these Terms. If you do not
          agree, do not use the platform.
        </div>

        <Section title="1. About ConstructIQ">
          <p>
            ConstructIQ is a cloud-based platform that enables construction businesses to manage
            tenders, RFIs (Requests for Information), project documents, and team collaboration.
            The platform is operated by Total Home Solutions HB LTD, a company registered in
            New Zealand with offices at 207 St Aubyn Street East, Hastings.
          </p>
        </Section>

        <Section title="2. Acceptance of Terms">
          <p>
            By creating an account, accepting an invitation, or otherwise using ConstructIQ, you
            confirm that you:
          </p>
          <Ul items={[
            'Are 18 years of age or older',
            'Are authorised to enter into these Terms on behalf of yourself or the organisation you represent',
            'Have read and understood these Terms and agree to be bound by them',
          ]} />
          <p>
            We may update these Terms from time to time. The current version is always available
            at this page. Continued use of the platform after changes are posted means you accept
            the updated Terms.
          </p>
        </Section>

        <Section title="3. Access — Invite Only">
          <p>
            ConstructIQ is an invite-only platform. You may only create an account if you have
            been invited by an authorised administrator. Public self-registration is not permitted.
          </p>
          <p>
            Your access level within the platform (for example, administrator, internal team
            member, or subcontractor) is determined by the organisation that invited you.
            We may change, suspend, or remove your access at the request of that organisation
            or for any reason under these Terms.
          </p>
        </Section>

        <Section title="4. Your Account">
          <p>You are responsible for:</p>
          <Ul items={[
            'Keeping your login credentials secure and not sharing them with others',
            'All activity that occurs under your account',
            'Notifying us immediately if you suspect unauthorised access to your account',
            'Ensuring your account information is accurate and kept up to date',
          ]} />
          <p>
            Each person must have their own individual account. Shared or generic accounts are
            not permitted.
          </p>
        </Section>

        <Section title="5. Acceptable Use">
          <p>You agree to use ConstructIQ only for lawful purposes and in accordance with these Terms. You must not:</p>
          <Ul items={[
            'Use the platform for any illegal purpose or in violation of any applicable law or regulation',
            'Upload or share content that is defamatory, fraudulent, offensive, or infringes the rights of others',
            'Attempt to gain unauthorised access to any part of the platform or another user\'s account',
            'Interfere with or disrupt the platform\'s operation or infrastructure',
            'Use automated tools to scrape, harvest, or extract data from the platform without our written consent',
            'Impersonate any person or organisation',
            'Upload files that contain malware, viruses, or malicious code',
          ]} />
          <p>
            We reserve the right to suspend or terminate access to any account that breaches
            these acceptable use requirements.
          </p>
        </Section>

        <Section title="6. Your Content">
          <p>
            You retain ownership of any content you upload or create within ConstructIQ, including
            documents, files, and project information ("Your Content").
          </p>
          <p>
            By uploading content to the platform, you grant us a limited licence to store,
            process, and display that content solely for the purpose of providing the platform
            to you and your authorised project team. We do not claim any ownership over Your Content.
          </p>
          <p>
            You are responsible for ensuring you have the rights to upload and share any content
            you add to the platform, including any third-party documents, drawings, or materials.
          </p>
        </Section>

        <Section title="7. Intellectual Property">
          <p>
            ConstructIQ, including its design, features, software, and branding, is the intellectual
            property of Total Home Solutions HB LTD. Nothing in these Terms grants you any right
            to use our name, logo, or trademarks without our prior written consent.
          </p>
          <p>
            You may not copy, modify, distribute, or create derivative works based on the platform
            or its software.
          </p>
        </Section>

        <Section title="8. Service Availability">
          <p>
            We aim to provide a reliable and available service but do not guarantee uninterrupted
            access. The platform may be unavailable from time to time due to maintenance, updates,
            or circumstances outside our control.
          </p>
          <p>
            We reserve the right to modify, suspend, or discontinue any part of the platform at
            any time. Where reasonably practicable, we will provide advance notice of significant
            changes.
          </p>
        </Section>

        <Section title="9. Limitation of Liability">
          <p>
            To the maximum extent permitted by New Zealand law, Total Home Solutions HB LTD will
            not be liable for:
          </p>
          <Ul items={[
            'Any indirect, incidental, special, or consequential losses arising from your use of the platform',
            'Loss of data, revenue, profits, or business opportunities',
            'Any disruption, delay, or failure of the platform',
            'The accuracy, completeness, or suitability of any content uploaded by users',
          ]} />
          <p>
            Nothing in these Terms limits or excludes any rights you have under the Consumer
            Guarantees Act 1993 or Fair Trading Act 1986 where those Acts apply.
          </p>
          <p>
            Where liability cannot be excluded, our total liability to you for any claim arising
            from your use of the platform is limited to the amount you paid us (if any) in the
            three months preceding the claim.
          </p>
        </Section>

        <Section title="10. Termination">
          <p>
            You may stop using ConstructIQ at any time. If you wish to have your account deleted,
            please contact us at{' '}
            <a href="mailto:info@thshb.co.nz" className="text-primary hover:underline">info@thshb.co.nz</a>.
          </p>
          <p>
            We may suspend or terminate your access immediately if:
          </p>
          <Ul items={[
            'You breach these Terms',
            'The organisation that invited you to the platform removes your access',
            'We reasonably suspect fraudulent, abusive, or illegal activity',
            'We decide to discontinue the platform',
          ]} />
          <p>
            On termination, your right to access the platform ceases. Provisions of these Terms
            that by their nature should survive termination will continue to apply.
          </p>
        </Section>

        <Section title="11. Privacy">
          <p>
            Your use of ConstructIQ is also governed by our{' '}
            <Link to="/privacy" className="text-primary hover:underline">Privacy Policy</Link>,
            which is incorporated into these Terms by reference. Please read it carefully.
          </p>
        </Section>

        <Section title="12. Governing Law">
          <p>
            These Terms are governed by the laws of New Zealand. Any disputes arising from or
            relating to these Terms or your use of ConstructIQ will be subject to the exclusive
            jurisdiction of the New Zealand courts.
          </p>
        </Section>

        <Section title="13. Contact Us">
          <p>If you have any questions about these Terms, please contact:</p>
          <div className="bg-muted/40 rounded-lg border border-border p-4 space-y-1">
            <p className="font-medium text-foreground">Total Home Solutions HB LTD</p>
            <p>207 St Aubyn Street East, Hastings, New Zealand</p>
            <p>
              Email:{' '}
              <a href="mailto:info@thshb.co.nz" className="text-primary hover:underline">info@thshb.co.nz</a>
            </p>
          </div>
        </Section>

      </main>

      {/* Footer */}
      <footer className="border-t border-border py-6 px-6 mt-8">
        <p className="text-center text-xs text-muted-foreground/60">
          &copy; {new Date().getFullYear()} ConstructIQ &nbsp;&bull;&nbsp; Total Home Solutions HB LTD
          &nbsp;&bull;&nbsp;
          <Link to="/privacy" className="hover:underline">Privacy Policy</Link>
          &nbsp;&bull;&nbsp;
          <Link to="/terms" className="hover:underline">Terms of Use</Link>
        </p>
      </footer>

    </div>
  );
}
