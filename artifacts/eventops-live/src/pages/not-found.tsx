import { Link } from 'wouter';

export default function NotFound() {
  return (
    <div className="eo-empty" style={{ paddingTop: 60 }}>
      <h3>This page does not exist</h3>
      <p><Link href="/">Go to my home page</Link></p>
    </div>
  );
}
