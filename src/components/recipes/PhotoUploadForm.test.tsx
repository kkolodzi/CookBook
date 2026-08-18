// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import PhotoUploadForm from "./PhotoUploadForm";

const DEGRADED_NOTICE_TEXT = /Nie wszystkie elementy przepisu udało się rozpoznać/i;

function jsonResponse(body: unknown, ok = true, status = ok ? 200 : 500): Response {
  return {
    ok,
    status,
    json: () => Promise.resolve(body),
  } as Response;
}

function samplePhoto(): File {
  return new File(["data"], "photo.jpg", { type: "image/jpeg" });
}

function selectAndSubmit(container: HTMLElement) {
  const fileInput = container.querySelector<HTMLInputElement>("#photo");
  if (!fileInput) throw new Error("file input not found");
  fireEvent.change(fileInput, { target: { files: [samplePhoto()] } });
  fireEvent.click(screen.getByRole("button", { name: /prześlij zdjęcie/i }));
}

describe("PhotoUploadForm", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    URL.createObjectURL = vi.fn(() => "blob:mock-url");
    URL.revokeObjectURL = vi.fn();
  });

  it("shows the content-degraded notice when the API response is content-degraded", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          success: true,
          recipe: {
            id: "recipe-1",
            name: "Zupa",
            type: "soup",
            ingredients: ["marchew"],
            instructions: null,
            photoUrl: null,
          },
          typeUnconfirmed: false,
          contentDegraded: true,
        }),
      ),
    );

    const { container } = render(<PhotoUploadForm />);
    selectAndSubmit(container);

    expect(await screen.findByText(DEGRADED_NOTICE_TEXT)).toBeInTheDocument();
  });

  it("shows no content-degraded notice for a clean success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          success: true,
          recipe: {
            id: "recipe-2",
            name: "Barszcz czerwony",
            type: "soup",
            ingredients: ["marchew", "cebula"],
            instructions: "Ugotuj warzywa.",
            photoUrl: null,
          },
          typeUnconfirmed: false,
          contentDegraded: false,
        }),
      ),
    );

    const { container } = render(<PhotoUploadForm />);
    selectAndSubmit(container);

    await screen.findByText("Barszcz czerwony");
    expect(screen.queryByText(DEGRADED_NOTICE_TEXT)).not.toBeInTheDocument();
  });

  it("renders the classified-failure copy for a failed extraction", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ success: false, reason: "not_a_recipe" })));

    const { container } = render(<PhotoUploadForm />);
    selectAndSubmit(container);

    expect(await screen.findByText("To nie wygląda na przepis")).toBeInTheDocument();
  });
});
