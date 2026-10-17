#include <cstdlib>
#include <cstring>

int main() {
  const size_t chunk = 16 * 1024 * 1024;
  for (;;) {
    char* block = static_cast<char*>(std::malloc(chunk));
    if (!block) return 2;
    std::memset(block, 1, chunk);
  }
}
