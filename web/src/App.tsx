import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './store';
import MainLayout from './layout/MainLayout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Materials from './pages/master/Materials';
import MaterialImport from './pages/master/MaterialImport';
import Suppliers from './pages/master/Suppliers';
import Locations from './pages/master/Locations';
import Units from './pages/master/Units';
import Abc from './pages/master/Abc';
import Bom from './pages/master/Bom';
import Products from './pages/master/Products';
import Logs from './pages/Logs';
import Forbidden from './pages/Forbidden';
import InboundEntry from './pages/inbound/InboundEntry';
import InboundRecords from './pages/inbound/InboundRecords';
import BatchStock from './pages/inbound/BatchStock';
import RequisitionEntry from './pages/requisition/RequisitionEntry';
import RequisitionRecords from './pages/requisition/RequisitionRecords';
import LineLedger from './pages/requisition/LineLedger';

function RequireAuth({ children }: { children: JSX.Element }) {
  const token = useAuth((s) => s.token);
  if (!token) return <Navigate to="/login" replace />;
  return children;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          path="/app"
          element={
            <RequireAuth>
              <MainLayout />
            </RequireAuth>
          }
        >
          <Route index element={<Navigate to="dashboard" replace />} />
          <Route path="dashboard" element={<Dashboard />} />
          <Route path="master/materials" element={<Materials />} />
          <Route path="master/materials/import" element={<MaterialImport />} />
          <Route path="master/suppliers" element={<Suppliers />} />
          <Route path="master/locations" element={<Locations />} />
          <Route path="master/units" element={<Units />} />
          <Route path="master/abc" element={<Abc />} />
          <Route path="master/products" element={<Products />} />
          <Route path="master/bom" element={<Bom />} />
          <Route path="inbound/entry" element={<InboundEntry />} />
          <Route path="inbound/records" element={<InboundRecords />} />
          <Route path="inbound/stock" element={<BatchStock />} />
          <Route path="requisition/entry" element={<RequisitionEntry />} />
          <Route path="requisition/records" element={<RequisitionRecords />} />
          <Route path="requisition/ledger" element={<LineLedger />} />
          <Route path="logs" element={<Logs />} />
        </Route>
        <Route path="/403" element={<Forbidden />} />
        <Route path="*" element={<Navigate to="/app" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
