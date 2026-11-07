import React from 'react';
import {createRoot} from 'react-dom/client';
import {BrowserRouter,useLocation} from 'react-router-dom';
import {App} from './App';
import {ApiDocs} from './pages/ApiDocs';
import './styles.css';
import './design-v2.css';
import './integrations.css';
import './reports.css';
import './goto-rich.css';
import './template-library.css';
import './api-docs.css';
import './notifications.css';
function Root(){
 const location=useLocation();
 if(location.pathname==='/docs'||location.pathname.startsWith('/docs/'))return <ApiDocs/>;
 return <App/>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><BrowserRouter><Root/></BrowserRouter></React.StrictMode>);
