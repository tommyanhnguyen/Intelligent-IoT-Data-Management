import React from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";

import Layout from "./components/Layout";
import ProtectedRoute from "./components/ProtectedRoute";

import Login from "./pages/Login";
import HomePage from "./pages/HomePage";
import DashboardPage from "./pages/DashboardPage";
import DeveloperMetricsPage from "./pages/DeveloperMetricsPage";
import RegistrationPage from "./pages/RegistrationPage";
import ForgotPassword from "./pages/ForgotPassword";
import AboutPage from "./pages/AboutPage";
import AnalysisHistoryPage, { AnalysisRunPlaceholder } from "./pages/AnalysisHistoryPage";
import { ANALYSIS_HISTORY_PATH, ANALYSIS_RUN_PATH } from "./utils/analysisHistoryRoutes";

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Login />} />
        <Route path="/register" element={<RegistrationPage />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />

        <Route
          path="/home"
          element={
            <ProtectedRoute>
              <Layout>
                <HomePage />
              </Layout>
            </ProtectedRoute>
          }
        />
        <Route
          path={ANALYSIS_HISTORY_PATH}
          element={
            <ProtectedRoute>
              <Layout>
                <AnalysisHistoryPage />
              </Layout>
            </ProtectedRoute>
          }
        />
        <Route
          path={ANALYSIS_RUN_PATH}
          element={
            <ProtectedRoute>
              <Layout>
                <AnalysisRunPlaceholder />
              </Layout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/about"
          element={
            <ProtectedRoute>
              <Layout>
                <AboutPage />
              </Layout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/dashboard/:id"
          element={
            <ProtectedRoute>
              <Layout>
                <DashboardPage />
              </Layout>
            </ProtectedRoute>
          }
        />

        <Route
  path="/developer-metrics/:id"
  element={
    <ProtectedRoute>
      <Layout>
        <DeveloperMetricsPage />
      </Layout>
    </ProtectedRoute>
  }
/>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
