import React from 'react';
import { createRoot } from 'react-dom/client';
import { OfflineOrderPreparation } from '../../components/offline-order-preparation';
createRoot(document.getElementById('root')!).render(<OfflineOrderPreparation actorEmail="staff@example.test" />);
