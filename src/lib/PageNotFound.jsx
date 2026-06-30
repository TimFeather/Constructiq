import { Link, useNavigate } from 'react-router-dom';
import { HardHat, ArrowLeft, LayoutDashboard } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function PageNotFound() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6 bg-background">

      {/* Brand mark */}
      <div className="flex items-center gap-2 mb-12">
        <div className="w-9 h-9 rounded-lg bg-primary flex items-center justify-center">
          <HardHat className="w-5 h-5 text-primary-foreground" />
        </div>
        <span className="text-lg font-semibold text-foreground">ConstructIQ</span>
      </div>

      <div className="max-w-md w-full text-center space-y-6">

        {/* 404 number */}
        <div>
          <p className="text-8xl font-bold text-primary/20 leading-none select-none">404</p>
        </div>

        {/* Message */}
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold text-foreground">Page not found</h1>
          <p className="text-muted-foreground leading-relaxed">
            The page you're looking for doesn't exist or may have been moved.
            Head back to the dashboard to find what you need.
          </p>
        </div>

        {/* Actions */}
        <div className="flex flex-col sm:flex-row gap-3 justify-center pt-2">
          <Button asChild>
            <Link to="/dashboard">
              <LayoutDashboard className="w-4 h-4 mr-2" />
              Go to Dashboard
            </Link>
          </Button>
          <Button variant="outline" onClick={() => navigate(-1)}>
            <ArrowLeft className="w-4 h-4 mr-2" />
            Go Back
          </Button>
        </div>

      </div>

      {/* Footer */}
      <p className="mt-16 text-xs text-muted-foreground/60">
        If you think this is a mistake, contact your administrator.
      </p>

    </div>
  );
}
