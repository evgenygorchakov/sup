"""Конвертирует PDF в markdown через marker. В stdout — одна строка JSON, всё остальное в stderr."""

import argparse
import json
import sys
from contextlib import redirect_stdout
from pathlib import Path

IMAGE_NAME_LIMIT = 120

# Настоящий stdout: конвертация идёт под redirect_stdout, а ответ должен уйти мимо него.
STDOUT = sys.stdout


def reply(payload):
    print(json.dumps(payload, ensure_ascii=False), file=STDOUT, flush=True)


def fail(message):
    reply({"ok": False, "error": message})
    sys.exit(1)


def parse_args():
    parser = argparse.ArgumentParser(description="конвертирует PDF в markdown")
    parser.add_argument("input", help="путь к PDF")
    parser.add_argument("output", help="куда записать markdown")
    parser.add_argument("--images", default=None, help="каталог для картинок; без него картинки не извлекаются")
    parser.add_argument("--force-ocr", action="store_true", help="распознавать текст даже там, где он есть")
    return parser.parse_args()


def count_pages(rendered):
    stats = getattr(rendered, "metadata", None) or {}
    pages = stats.get("page_stats")
    return len(pages) if isinstance(pages, list) else None


def save_images(images, directory):
    if not images:
        return 0

    target = Path(directory).expanduser()
    target.mkdir(parents=True, exist_ok=True)
    saved = 0
    for name, image in images.items():
        safe = Path(str(name)).name[:IMAGE_NAME_LIMIT]
        if not safe:
            continue
        try:
            image.save(target / safe)
            saved += 1
        except Exception as failure:
            print(f"[marker] картинка {safe} не сохранена: {failure}", file=sys.stderr, flush=True)
    return saved


def convert(source, args):
    # Импорт здесь, а не наверху: он поднимает torch и стоит секунды, а ошибки в аргументах должны падать раньше.
    try:
        from marker.config.parser import ConfigParser
        from marker.converters.pdf import PdfConverter
        from marker.models import create_model_dict
        from marker.output import text_from_rendered
    except ImportError as failure:
        fail(f"marker не установлен в venv: {failure}")

    settings = {"output_format": "markdown", "disable_image_extraction": args.images is None}
    if args.force_ocr:
        settings["force_ocr"] = True

    config_parser = ConfigParser(settings)
    converter = PdfConverter(
        config=config_parser.generate_config_dict(),
        artifact_dict=create_model_dict(),
        processor_list=config_parser.get_processors(),
        renderer=config_parser.get_renderer(),
    )

    try:
        rendered = converter(str(source))
    except Exception as failure:
        fail(f"marker не смог прочитать {source.name}: {failure}")

    text, _, images = text_from_rendered(rendered)
    return text, images, count_pages(rendered)


def main():
    args = parse_args()
    source = Path(args.input).expanduser()
    target = Path(args.output).expanduser()

    if not source.is_file():
        fail(f"файл не найден: {source}")

    # Модели и их зависимости печатают в stdout; там должен остаться только наш JSON.
    with redirect_stdout(sys.stderr):
        text, images, pages = convert(source, args)

    saved = save_images(images, args.images) if args.images else 0

    try:
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(text, encoding="utf-8")
    except OSError as failure:
        fail(f"не удалось записать {target}: {failure}")

    reply({"ok": True, "path": str(target), "pages": pages, "chars": len(text), "images": saved})


if __name__ == "__main__":
    main()
