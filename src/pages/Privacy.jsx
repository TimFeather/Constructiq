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

export default function Privacy() {
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
          <h1 className="text-3xl font-bold text-foreground mb-2">Privacy Policy</h1>
          <p className="text-sm text-muted-foreground">Last updated: 30 June 2026</p>
        </div>

        <div className="text-sm text-muted-foreground leading-relaxed mb-6">
          This Privacy Policy explains how Total Home Solutions HB LTD ("we", "us", "our") collects,
          uses, stores, and protects personal information in connection with ConstructIQ, our
          construction project management platform. We are committed to complying with the
          New Zealand Privacy Act 2020.
        </div>

        <Section title="1. Who We Are">
          <p>
            Total Home Solutions HB LTD is a New Zealand registered company. Our registered address
            is 207 St Aubyn Street East, Hastings, New Zealand. You can contact us about privacy
            matters at <a href="mailto:info@thshb.co.nz" className="text-primary hover:underline">info@thshb.co.nz</a>.
          </p>
          <p>
            ConstructIQ is an invite-only platform used by construction businesses and their project
            teams to manage tenders, RFIs, documents, and project workflows.
          </p>
        </Section>

        <Section title="2. What Personal Information We Collect">
          <p>We collect the following types of personal information:</p>
          <p className="font-medium text-foreground">Account information</p>
          <Ul items={[
            'Full name',
            'Email address',
            'Phone number',
            'Business or company name',
            'Your role within the platform (e.g. administrator, subcontractor)',
          ]} />
          <p className="font-medium text-foreground">Project and work content</p>
          <Ul items={[
            'Project names, descriptions, and details you enter',
            'Documents and files you upload',
            'Requests for Information (RFIs) you create or respond to',
            'Tender submissions and pricing information',
            'Messages and comments posted within the platform',
          ]} />
          <p className="font-medium text-foreground">Activity and technical data</p>
          <Ul items={[
            'Audit logs of actions taken within the platform (e.g. who uploaded a file, who changed a setting)',
            'Login timestamps and session information',
            'IP address and browser information (collected automatically by our hosting and authentication providers)',
          ]} />
        </Section>

        <Section title="3. How We Collect Personal Information">
          <p>We collect personal information:</p>
          <Ul items={[
            'Directly from you when you register for an account, fill in your profile, or use the platform',
            'From the person or organisation who invited you to the platform (your name and email may be entered by an administrator before you sign up)',
            'Automatically through our technical infrastructure when you use the platform',
          ]} />
        </Section>

        <Section title="4. Why We Collect and Use Personal Information">
          <p>We use your personal information to:</p>
          <Ul items={[
            'Create and manage your account',
            'Provide the ConstructIQ platform and its features',
            'Send you notifications about project activity, RFIs, tenders, and documents',
            'Allow collaboration between project team members and subcontractors',
            'Maintain an audit trail for accountability and project records',
            'Respond to your support requests',
            'Improve and maintain the security of the platform',
          ]} />
          <p>
            We only use your personal information for the purposes it was collected for, or for closely
            related purposes you would reasonably expect.
          </p>
        </Section>

        <Section title="5. Who We Share Personal Information With">
          <p>
            We do not sell your personal information. We share it only as necessary to operate the
            platform, with the following trusted service providers:
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border border-border rounded-lg overflow-hidden">
              <thead>
                <tr className="bg-muted/50">
                  <th className="text-left px-4 py-2 font-medium text-foreground border-b border-border">Provider</th>
                  <th className="text-left px-4 py-2 font-medium text-foreground border-b border-border">Purpose</th>
                  <th className="text-left px-4 py-2 font-medium text-foreground border-b border-border">Location</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-border">
                  <td className="px-4 py-2 font-medium text-foreground">Supabase Inc</td>
                  <td className="px-4 py-2">Database, user authentication, and file storage</td>
                  <td className="px-4 py-2">USA (AWS infrastructure)</td>
                </tr>
                <tr className="border-b border-border">
                  <td className="px-4 py-2 font-medium text-foreground">Vercel Inc</td>
                  <td className="px-4 py-2">Web application hosting and content delivery</td>
                  <td className="px-4 py-2">USA</td>
                </tr>
                <tr>
                  <td className="px-4 py-2 font-medium text-foreground">Resend Inc</td>
                  <td className="px-4 py-2">Delivery of notification and transactional emails</td>
                  <td className="px-4 py-2">USA</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p>
            <strong className="text-foreground">Overseas disclosure:</strong> Our service providers are
            based in the United States. By using ConstructIQ, you acknowledge that your personal
            information may be transferred to and stored in the United States. We take reasonable
            steps to ensure these providers maintain appropriate security standards and contractual
            privacy obligations.
          </p>
          <p>
            We may also disclose personal information if required to do so by law, or to protect
            the rights, property, or safety of our business or others.
          </p>
        </Section>

        <Section title="6. How We Store and Protect Personal Information">
          <p>
            Personal information is stored on Supabase's secure cloud infrastructure. We apply the
            following security measures:
          </p>
          <Ul items={[
            'Row-level security controls so users can only access data they are authorised to see',
            'Encrypted connections (HTTPS/TLS) for all data in transit',
            'Secure, signed URLs for file access — files cannot be accessed without a valid session',
            'Role-based access control — different user roles have different levels of access',
            'Audit logging of sensitive actions within the platform',
          ]} />
          <p>
            While we take reasonable precautions, no system is completely secure. If you believe
            your account has been compromised, please contact us immediately.
          </p>
        </Section>

        <Section title="7. How Long We Keep Personal Information">
          <p>
            We retain personal information for as long as your account is active and as reasonably
            necessary to provide our services. When an account is deleted:
          </p>
          <Ul items={[
            'Account profile information is removed',
            'Project content (documents, RFIs, tenders) may be retained for the benefit of other project participants unless all parties request deletion',
            'Audit logs may be retained for a reasonable period for compliance and security purposes',
          ]} />
          <p>
            You may request deletion of your personal information at any time by contacting us
            at <a href="mailto:info@thshb.co.nz" className="text-primary hover:underline">info@thshb.co.nz</a>.
          </p>
        </Section>

        <Section title="8. Your Rights Under the Privacy Act 2020">
          <p>Under the New Zealand Privacy Act 2020, you have the right to:</p>
          <Ul items={[
            'Ask whether we hold personal information about you, and request access to it',
            'Request that we correct any personal information that is inaccurate, out of date, incomplete, or misleading',
            'Make a complaint if you believe we have interfered with your privacy',
          ]} />
          <p>
            To exercise any of these rights, contact us at{' '}
            <a href="mailto:info@thshb.co.nz" className="text-primary hover:underline">info@thshb.co.nz</a>.
            We will respond within 20 working days as required by the Act.
          </p>
          <p>
            If you are not satisfied with our response, you may complain to the Office of the
            Privacy Commissioner at{' '}
            <a href="https://www.privacy.org.nz" className="text-primary hover:underline" target="_blank" rel="noreferrer">www.privacy.org.nz</a>.
          </p>
        </Section>

        <Section title="9. Cookies and Tracking">
          <p>
            ConstructIQ uses session cookies and browser local storage to maintain your login
            session. We do not use advertising cookies or third-party tracking technologies.
            Technical session data is managed by Supabase and is necessary for the platform to function.
          </p>
        </Section>

        <Section title="10. Changes to This Policy">
          <p>
            We may update this Privacy Policy from time to time. When we make material changes,
            we will update the "Last updated" date at the top of this page. Continued use of
            ConstructIQ after changes are posted constitutes acceptance of the updated policy.
          </p>
        </Section>

        <Section title="11. Contact Us">
          <p>For any privacy questions or requests, please contact:</p>
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
