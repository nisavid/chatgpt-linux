use std::io::{self, BufReader, BufWriter};
use std::os::fd::BorrowedFd;

fn main() {
    if std::env::args_os().len() != 1 {
        eprintln!("mutation broker does not accept path arguments");
        std::process::exit(2);
    }
    // SAFETY: fd 3 is the broker's documented inherited root capability. It is
    // borrowed for this process's lifetime and is never closed by this value.
    let root = unsafe { BorrowedFd::borrow_raw(3) };
    let stdin = io::stdin();
    let stdout = io::stdout();
    if let Err(error) = generated_app_mutation_broker::serve(
        root,
        BufReader::new(stdin.lock()),
        BufWriter::new(stdout.lock()),
    ) {
        eprintln!("mutation broker terminated: {error}");
        std::process::exit(1);
    }
}
