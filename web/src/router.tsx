import { createBrowserRouter, Outlet, redirect } from "react-router-dom";
import { lazy, Suspense } from "react";

import { AnalyticsTracker } from "@/components/layout/analytics-tracker";
import UserLayout from "@/layouts/user-layout";
import AccountPage from "@/pages/account";
import AssetsPage from "@/pages/assets";
import CanvasPage from "@/pages/canvas";
import CanvasProjectPage from "@/pages/canvas/project";
import StudioProjectPage from "@/pages/studio/project";
import ConfigPage from "@/pages/config";
import HomePage from "@/pages/home";
import ImagePage from "@/pages/image";
import NotFound from "@/pages/not-found";
import InstallPage from "@/pages/install";
import PromptsPage from "@/pages/prompts";
import DramaPage from "@/pages/drama";
import DramaProjectPage from "@/pages/drama/project";
import VideoPage from "@/pages/video";
import { cloudModeEnabled, cloudPlatform } from "@/services/cloud-platform";
import { installationRedirect } from "@/services/installation-route";
const AdminPage = lazy(() => import("@/pages/admin"));

export const router = createBrowserRouter([
    {
        loader: async ({ request }) => {
            const target = await installationRedirect(new URL(request.url).pathname, cloudModeEnabled, cloudPlatform);
            return target ? redirect(target) : null;
        },
        element: (
            <UserLayout>
                <AnalyticsTracker />
                <Outlet />
            </UserLayout>
        ),
        children: [
            { path: "/", element: <HomePage /> },
            { path: "/image", element: <ImagePage /> },
            { path: "/video", element: <VideoPage /> },
            { path: "/assets", element: <AssetsPage /> },
            { path: "/prompts", element: <PromptsPage /> },
            { path: "/drama", element: <DramaPage /> },
            { path: "/drama/:id", element: <DramaProjectPage /> },
            { path: "/canvas", element: <CanvasPage /> },
            { path: "/canvas/:id", element: <CanvasProjectPage /> },
            { path: "/canvas/:id/studio", element: <StudioProjectPage /> },
            { path: "/config", element: <ConfigPage /> },
            { path: "/account", element: <AccountPage /> },
            {
                path: "/admin",
                element: (
                    <Suspense fallback={<div className="p-8 text-sm text-stone-500">正在加载管理后台…</div>}>
                        <AdminPage />
                    </Suspense>
                ),
            },
        ],
    },
    {
        path: "/install",
        loader: async ({ request }) => {
            const target = await installationRedirect(new URL(request.url).pathname, cloudModeEnabled, cloudPlatform);
            return target ? redirect(target) : null;
        },
        element: <InstallPage />,
    },
    { path: "*", element: <NotFound /> },
]);
