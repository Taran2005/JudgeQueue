#include <cstdlib>
#include <unistd.h>

int main() {
  for (;;) {
    if (fork() < 0) std::exit(3);
  }
}
