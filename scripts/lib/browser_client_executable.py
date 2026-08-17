"""Minimal JavaScript executable-range filtering for bundled Browser patch anchors."""

_REGEX_PREFIX_KEYWORDS = {
    "await", "break", "case", "continue", "delete", "do", "else", "in",
    "instanceof", "new", "of", "return", "throw", "typeof", "void", "yield",
}


def executable_offsets(source):
    offsets = bytearray(b"\x01") * len(source)
    index = 0
    can_start_regex = True
    while index < len(source):
        char = source[index]
        next_char = source[index + 1] if index + 1 < len(source) else ""
        if char in "'\"`":
            quote = char
            offsets[index] = 0
            index += 1
            escaped = False
            while index < len(source):
                offsets[index] = 0
                current = source[index]
                if escaped:
                    escaped = False
                elif current == "\\":
                    escaped = True
                elif current == quote:
                    index += 1
                    break
                index += 1
            can_start_regex = False
            continue
        if char == "/" and next_char in ("/", "*"):
            offsets[index] = offsets[index + 1] = 0
            index += 2
            if next_char == "/":
                while index < len(source) and source[index] not in "\r\n":
                    offsets[index] = 0
                    index += 1
            else:
                while index < len(source):
                    offsets[index] = 0
                    if source[index:index + 2] == "*/":
                        if index + 1 < len(source):
                            offsets[index + 1] = 0
                        index += 2
                        break
                    index += 1
            continue
        if char == "/" and can_start_regex:
            offsets[index] = 0
            index += 1
            escaped = False
            in_class = False
            while index < len(source):
                offsets[index] = 0
                current = source[index]
                if escaped:
                    escaped = False
                elif current == "\\":
                    escaped = True
                elif current == "[":
                    in_class = True
                elif current == "]":
                    in_class = False
                elif current == "/" and not in_class:
                    index += 1
                    while index < len(source) and source[index].isalpha():
                        offsets[index] = 0
                        index += 1
                    break
                index += 1
            can_start_regex = False
            continue
        if char.isspace():
            index += 1
            continue
        if char.isalpha() or char in "_$":
            end = index + 1
            while end < len(source) and (source[end].isalnum() or source[end] in "_$"):
                end += 1
            can_start_regex = source[index:end] in _REGEX_PREFIX_KEYWORDS
            index = end
            continue
        if char.isdigit():
            index += 1
            while index < len(source) and (source[index].isalnum() or source[index] in "._"):
                index += 1
            can_start_regex = False
            continue
        can_start_regex = char in "([{,;:?=+!*%&|^~<>-"
        index += 1
    return offsets


def executable_matches(pattern, source):
    offsets = executable_offsets(source)
    return [match for match in pattern.finditer(source) if offsets[match.start()]]
