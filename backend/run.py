#!/usr/bin/env python
"""Run the Trends ML Data BFF."""
from __future__ import annotations

import uvicorn

from app.config import get_settings


def main() -> None:
    settings = get_settings()
    uvicorn.run(
        "app.main:app",
        host=settings.bff_host,
        port=settings.bff_port,
        reload=True,
    )


if __name__ == "__main__":
    main()
