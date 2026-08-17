"""Minimal JavaScript executable-range filtering for bundled Browser patch anchors."""

_REGEX_PREFIX_KEYWORDS = {
    "await", "break", "case", "continue", "debugger", "default", "delete", "do",
    "else", "extends", "in", "instanceof", "new", "of", "return", "throw",
    "typeof", "void", "yield",
}
_CONTROL_PAREN_KEYWORDS = {"catch", "for", "if", "switch", "while", "with"}


def executable_offsets(source):
    offsets = bytearray(b"\x01") * len(source)
    index = 0
    can_start_regex = True
    pending_control_paren = False
    pending_break_or_continue = False
    pending_break_or_continue_label = False
    paren_contexts = []
    brace_contexts = []
    next_brace_is_statement = False
    template_contexts = []
    while index < len(source):
        char = source[index]
        next_char = source[index + 1] if index + 1 < len(source) else ""
        if index == 0 and char == "#" and next_char == "!":
            while index < len(source) and source[index] not in "\r\n":
                offsets[index] = 0
                index += 1
            can_start_regex = True
            continue
        if template_contexts and not template_contexts[-1][0]:
            offsets[index] = 0
            if char == "\\":
                if index + 1 < len(source):
                    offsets[index + 1] = 0
                index += 2
                continue
            if char == "`":
                template_contexts.pop()
                pending_control_paren = False
                next_brace_is_statement = False
                can_start_regex = False
                index += 1
                continue
            if char == "$" and next_char == "{":
                offsets[index + 1] = 0
                template_contexts[-1][0] = True
                template_contexts[-1][1] = 0
                pending_control_paren = False
                next_brace_is_statement = False
                can_start_regex = True
                index += 2
                continue
            index += 1
            continue
        if char == "`":
            offsets[index] = 0
            template_contexts.append([False, 0])
            pending_control_paren = False
            next_brace_is_statement = False
            index += 1
            continue
        if char in "'\"":
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
            next_brace_is_statement = False
            can_start_regex = False
            continue
        if char == "/" and next_char in ("/", "*"):
            offsets[index] = offsets[index + 1] = 0
            index += 2
            if next_char == "/":
                while index < len(source) and source[index] not in "\r\n":
                    offsets[index] = 0
                    index += 1
                if pending_break_or_continue or pending_break_or_continue_label:
                    pending_break_or_continue = False
                    pending_break_or_continue_label = False
                    can_start_regex = True
            else:
                comment_start = index
                while index < len(source):
                    offsets[index] = 0
                    if source[index:index + 2] == "*/":
                        if index + 1 < len(source):
                            offsets[index + 1] = 0
                        index += 2
                        break
                    index += 1
                if (
                    pending_break_or_continue or pending_break_or_continue_label
                ) and any(character in "\r\n\u2028\u2029" for character in source[comment_start:index]):
                    pending_break_or_continue = False
                    pending_break_or_continue_label = False
                    can_start_regex = True
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
            next_brace_is_statement = False
            can_start_regex = False
            continue
        if char.isspace():
            if (
                pending_break_or_continue or pending_break_or_continue_label
            ) and char in "\r\n\u2028\u2029":
                pending_break_or_continue = False
                pending_break_or_continue_label = False
                can_start_regex = True
            index += 1
            continue
        if char.isalpha() or char in "_$":
            end = index + 1
            while end < len(source) and (source[end].isalnum() or source[end] in "_$"):
                end += 1
            token = source[index:end]
            if pending_break_or_continue:
                pending_break_or_continue = False
                pending_break_or_continue_label = True
                can_start_regex = False
                index = end
                continue
            if pending_control_paren and token == "await":
                can_start_regex = True
                index = end
                continue
            next_brace_is_statement = False
            pending_control_paren = token in _CONTROL_PAREN_KEYWORDS
            pending_break_or_continue = token in {"break", "continue"}
            pending_break_or_continue_label = False
            can_start_regex = pending_control_paren or token in _REGEX_PREFIX_KEYWORDS
            index = end
            continue
        if char.isdigit():
            pending_control_paren = False
            next_brace_is_statement = False
            index += 1
            while index < len(source) and (source[index].isalnum() or source[index] in "._"):
                index += 1
            can_start_regex = False
            continue
        if char == "(":
            paren_contexts.append("control" if pending_control_paren else "expression")
            pending_control_paren = False
            next_brace_is_statement = False
            can_start_regex = True
            index += 1
            continue
        pending_control_paren = False
        pending_break_or_continue = False
        pending_break_or_continue_label = False
        if char == ")":
            closed_control = bool(paren_contexts) and paren_contexts.pop() == "control"
            next_brace_is_statement = closed_control
            can_start_regex = closed_control
            index += 1
            continue
        if char == "/":
            next_brace_is_statement = False
            if next_char == "=":
                index += 1
            can_start_regex = True
            index += 1
            continue
        if source.startswith("...", index):
            next_brace_is_statement = False
            can_start_regex = True
            index += 3
            continue
        if char == "{" and template_contexts and template_contexts[-1][0]:
            brace_contexts.append("statement" if next_brace_is_statement else "expression")
            next_brace_is_statement = False
            template_contexts[-1][1] += 1
            can_start_regex = True
            index += 1
            continue
        if char == "}" and template_contexts and template_contexts[-1][0]:
            if template_contexts[-1][1] == 0:
                offsets[index] = 0
                template_contexts[-1][0] = False
                next_brace_is_statement = False
                can_start_regex = False
            else:
                template_contexts[-1][1] -= 1
                if brace_contexts:
                    brace_contexts.pop()
                next_brace_is_statement = True
                can_start_regex = True
            index += 1
            continue
        if char == "{":
            brace_contexts.append("statement" if next_brace_is_statement else "expression")
            next_brace_is_statement = False
            can_start_regex = True
            index += 1
            continue
        if char == "}":
            if brace_contexts:
                brace_contexts.pop()
            next_brace_is_statement = True
            can_start_regex = True
            index += 1
            continue
        next_brace_is_statement = False
        can_start_regex = char in "([{,;:?=+!*%&|^~<>-"
        index += 1
    return offsets


def executable_matches(pattern, source):
    offsets = executable_offsets(source)
    return [match for match in pattern.finditer(source) if offsets[match.start()]]
