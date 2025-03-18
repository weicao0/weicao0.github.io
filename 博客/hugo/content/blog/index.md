---
title: 网络服务器设计原理及分析
description: 
keywords: 网络服务器设计
slug: Network-Server-Design
cover.image: 
date: 2025-02-25T10:00:44+08:00
lastmod: 2025-03-18T11:31:59+08:00
categories:
  - 技术
tags:
  - 服务器
  - 事件驱动
draft: false
dir: 
share: true
---

在网络服务端编程中，服务器需要处理多个客户端的请求。为了提高性能，服务器通常会使用多种手段并发处理这些请求。基于非阻塞IO和事件驱动的并发机制可能是编写用户态高性能网络程序最成熟的模式。

<!--more-->
## 操作系统基础

### 用户空间与内核空间

操作系统都采用虚拟存储器，系统可访问的虚拟存储空间就是系统自身的寻址空间，例如32位操作系统对应4G（2的32次方）的寻址空间。操作系统通过内核（kernel）访问底层硬件设备，用户进程则由内核进行调度管理。为了保证用户进程不直接操作内核，系统将虚拟存储空间分为内核空间和用户空间两部分。针对32位linux操作系统而言，将最高的1G字节（虚拟地址0xC0000000-0xFFFFFFFF）分配为内核空间，较低的3G字节（虚拟地址0x00000000-0xBFFFFFFF）分配为用户空间。

### 进程切换

内核进行进程切换时，主要有下列处理过程：

- 保存处理机上下文，包括程序计数器和其他寄存器。
- 更新内核空间中的PCB（进程控制块Process Control Block）信息。
- 把进程的PCB移入相应的队列，如就绪、某事件阻塞等队列。
- 选择另一个进程执行，并更新其PCB。
- 更新内存管理的数据结构。
- 恢复处理机上下文。

总而言之，进程切换很耗费资源。

进程有就绪、运行、阻塞三种基本状态。正在运行的进程，会因为请求系统资源失败、等待操作完成、新数据未到达或无新工作做等原因由系统自动执行阻塞原语（Block），使自己从运行状态变为阻塞状态，从而退出CPU资源的占用。

### 文件描述符

当程序打开现有文件或新建文件时，内核会维护一个该进程打开文件的记录表，并通过文件描述符（File Descriptor）来对该文件记录表进行索引。一些涉及底层I/O的程序编写往往会围绕文件描述符展开。

### 缓存I/O

当程序进行I/O访问操作时，操作系统会先将I/O的数据缓存到文件系统的页缓存（Page Cache）中，也就是说，数据会先被拷贝到操作系统的内核缓冲区中，再从内核缓冲区拷贝到应用程序的地址空间。因为缓存I/O机制的存在，数据在传输过程中需要在用户空间和内核空间进行多次数据拷贝操作，这些数据拷贝操作所带来的CPU及内存开销通常是很大的。以I/O的read操作为例，会经历两个阶段：

- 等待数据就绪
- 将数据从内核空间拷贝到用户进程空间中

围绕这两个阶段，Linux系统产生了下面五种网络模式的方案：

- 阻塞 I/O（Blocking IO）
- 非阻塞 I/O（Nonblocking IO）
- I/O 多路复用（ IO multiplexing）
- 信号驱动 I/O（ Signal driven IO）
- 异步 I/O（Asynchronous IO）

#### 阻塞 I/O（Blocking IO）

在Linux中，默认情况下所有的socket操作都是blocking，一个典型的read操作流程如下：

![image-20210203164645371](assets/image-20210203164645371.png)

对于网络I/O，很多时候数据一开始还没有到达，例如还没有收到完整的UDP数据帧。因此，在用户调用recvfrom后，如果内核数据没有准备好，用户进程首先会被阻塞，kernel需要等待内核缓冲区的数据准备就绪，再将内核缓冲区中的数据拷贝到用户空间，并返回结果给用户进程，用户进程才可以解除block状态，继续运行。总结来说，Blocking I/O的特点就是I/O执行的两个阶段都需要block。

#### 非阻塞 I/O（Nonblocking IO）

Linux下可以通过设置socket属性使其变为non-blocking。对non-blocking socket的read操作如下：

![image-20210204095548850](assets/image-20210204095548850.png)

用户进程调用recvfrom后，如果kernel中的数据还没有准备好，进程不会被block，而是立刻收到一个error返回值。用户进程可以通过判断返回值结果来决定是继续发送read操作，还是执行其他指令。在后续的read操作中，如果此时kernel中的数据准备好了，系统才会将内核缓冲区中的数据拷贝到用户内存，并返回正常执行结果。总结来说，nonblocking I/O的特点是I/O执行的第一个阶段不需要block，由用户进程来主动询问kernel中的数据是否准备就绪。

#### I/O 多路复用（ IO multiplexing）

I/O 多路复用就是通常使用的select、poll、epoll，也称为event driven I/O。其基本原理就是select/poll/epoll函数（三者的区别见后文）不断的轮询负责的socket I/O，当某个socket有数据到达了，就通知用户进程。

![image-20210204101105947](assets/image-20210204101105947.png)

用户进程首先调用select函数，整个进程会被block，kernel监视select负责的socket I/O，当任何一个select中的I/O数据准备就绪，select就会返回。这个时候用户进程再调用read操作，将数据从kernel拷贝到用户内存。总结来说，I/O 多路复用的特点是单个进程同时处理多个网络连接I/O，即在进程中通过select/poll/epoll系统调用同时等待多个文件描述符，当这些文件描述符（套接字描述符）其中的任意一个进入读就绪状态，select()函数就可以返回。因为使用了select、recvfrom两个系统调用，如果处理的连接数不是很高的话，使用select/epoll的web server不一定比使用multi-threading + blocking I/O的web server性能更好，可能延时还更大。select/epoll的优势并不是对于单个连接能处理得更快，而是在于能处理更多的连接。

#### 信号驱动 I/O（ Signal driven IO）

信号驱动式I/O的过程如下图所示：

![image-20210204103934532](assets/image-20210204103934532.png)

首先注册处理函数到 SIGIO 信号上，然后设置可以接受SIGIO信号的进程ID，最后设置socket使能Signal-driven I/O Flag，此后用户进程继续执行。当数据准备好时，进程会收到一个SIGIO信号，可以在信号处理函数中调用I/O操作函数处理数据。

Signal driven IO对于TCP没什么用，[这篇文章](http://www.masterraghu.com/subjects/np/introduction/unix_network_programming_v1.3/ch25lev1sec2.html)给出了原因。因为产生的太过频繁，而且很多情况都会产生SIGIO 信号，比如：

- 对listening socket，一个连接请求完成
- 一个disconnect请求完成初始化
- 一个disconnect请求完成
- connection被shut down
- 数据到达
- 数据被发送
- asynchronous error产生

对于UDP，有下列情况会产生SIGIO信号：

- 数据帧到达
- asynchronous error产生

因此现在还在使用 Signal Driven IO 的基本是 UDP连接。

#### 异步 I/O（Asynchronous IO）

异步I/O的流程如下：

![image-20210204102742268](assets/image-20210204102742268.png)

用户进程发起read操作之后，立刻就可以开始去做其它的事。而另一方面，从kernel的角度，当它受到一个asynchronous read之后，首先它会立刻返回，所以不会对用户进程产生任何block。然后，kernel会等待数据准备完成，然后将数据拷贝到用户内存，当这一切都完成之后，kernel会给用户进程发送一个signal，告诉它read操作完成了。总结来说，Asynchronous I/O的特点就是在I/O执行的两个阶段都不会block用户进程，在收到kernel发送的信号前，用户进程都可以不理睬I/O的处理状态。

#### 各个I/O Model的比较

![image-20210204103548709](assets/image-20210204103548709.png)

epoll是Linux目前大规模网络并发程序开发的首选模型。在绝大多数情况下性能远超select和poll。目前流行的高性能web服务器Nginx正式依赖于epoll提供的高效网络套接字轮询服务。但是，在并发连接不高的情况下，多线程+阻塞I/O方式可能性能更好。

## I/O 多路复用之select、poll、epoll

三者基本的原理是相同的，流程如下

1. 先依次调用fd对应的struct file.f_op->poll()方法（如果有提供实现的话），尝试检查每个提供待检测IO的fd是否已经有IO事件就绪，并调用__pollwait回调函数将当前进程挂到设备的等待队列中，以便当设备驱动发生自身资源可读写后，唤醒其等待队列上睡眠的进程
2. 如果已经有IO事件就绪，则直接将所收集到的IO事件返回，本次调用结束
3. 如果暂时没有IO事件就绪，则根据所给定的超时参数，选择性地进入等待
4. 如果超时参数指示不等待，则本次调用结束，无IO事件返回
5. 如果超时参数指示等待（等待一段时间或持续等待），则将当前select/poll/epoll的调用任务挂起
6. 当所检测的fd任何一个有新的IO事件发生时，会将上述的处于等待的任务唤醒。任务被唤醒之后，重新执行1中的IO事件收集过程。

### select

```c
#include <sys/select.h>
#include <sys/time.h>

#define FD_SETSIZE 1024
#define NFDBITS (8 * sizeof(unsigned long))
#define __FDSET_LONGS (FD_SETSIZE/NFDBITS)

// 数据结构 (bitmap)
typedef struct {
    unsigned long fds_bits[__FDSET_LONGS];
} fd_set;

// API
int select (int n, fd_set *readfds, fd_set *writefds, fd_set *exceptfds, struct timeval *timeout);			    // 返回就绪描述符的数目                        

FD_ZERO(int fd, fd_set* fds);   // 清空集合
FD_SET(int fd, fd_set* fds);    // 将给定的描述符加入集合
FD_ISSET(int fd, fd_set* fds);  // 判断指定描述符是否在集合中 
FD_CLR(int fd, fd_set* fds);    // 将给定的描述符从文件中删除

```

select本质上是通过设置或者检查存放fd标志位的数据结构bitmap来进行下一步处理。select函数监视的文件描述符分writefds、readfds、和exceptfds 3类。调用select函数后进程会阻塞，直到有描述符就绪或超时。当select函数返回后，用户进程需要遍历fd_set，来找到就绪的描述符。

select目前几乎在所有的平台上支持，其良好跨平台支持是它的一个优点。select的缺点在于：

- 需要把想监控的文件描述集合通过函数参数的形式告诉select，然后select会将这些文件描述符集合拷贝到内核中，考虑到数据拷贝的性能损耗，单个进程所打开的FD是有限制的，通过FD_SETSIZE设置，默认1024
- 每次调用select，都需要把整个fd_set从用户空间拷贝到内核空间，这个开销在fd很多时会很大
- 对socket扫描时是线性扫描，采用轮询的方法，效率较低（高并发时）
- select返回的是含有整个句柄的数组，应用程序需要遍历整个数组才能发现哪些句柄发生了事件
- select的触发方式是水平触发，应用程序如果没有完成对一个已经就绪的文件描述符进行IO操作，那么之后每次select调用还是会将这些文件描述符通知进程

使用示例

```c
int main() {
  /*
   * 这里进行一些初始化的设置，
   * 包括socket建立，地址的设置等,
   */

  fd_set read_fs, write_fs;
  struct timeval timeout;
  int max = 0;  // 用于记录最大的fd，在轮询中时刻更新即可

  // 初始化比特位
  FD_ZERO(&read_fs);
  FD_ZERO(&write_fs);

  int nfds = 0; // 记录就绪的事件，可以减少遍历的次数
  while (1) {
    // 阻塞获取
    // 每次需要把fd从用户态拷贝到内核态
    nfds = select(max + 1, &read_fd, &write_fd, NULL, &timeout);
    // 每次需要遍历所有fd，判断有无读写事件发生
    for (int i = 0; i <= max && nfds; ++i) {
      if (i == listenfd) {
         --nfds;
         // 这里处理accept事件
         FD_SET(i, &read_fd);//将客户端socket加入到集合中
      }
      if (FD_ISSET(i, &read_fd)) {
        --nfds;
        // 这里处理read事件
      }
      if (FD_ISSET(i, &write_fd)) {
         --nfds;
        // 这里处理write事件
      }
    }
  }
```

### poll

```c
#include <poll.h>
// 数据结构
struct pollfd {
    int fd;                         // 需要监视的文件描述符
    short events;                   // 需要内核监视的事件
    short revents;                  // 实际发生的事件
};

// API
int poll(struct pollfd fds[], nfds_t nfds, int timeout);
```

poll本质上和select没有区别，它将用户传入的pollfd数组拷贝到内核空间，然后查询每个fd对应的设备状态，如果设备就绪则返回；如果遍历完所有fd后没有发现就绪设备，则挂起当前进程，直到设备就绪或者主动超时，被唤醒后它又要再次遍历fd，这个过程经历了多次无谓的遍历。

pollfd没有最大连接数的限制，原因是它是基于链表来存储的，但是同样有缺点：大量的fd的数组被整体复制于用户态和内核地址空间之间，而不管这样的复制是不是有意义。

从上面看，select和poll都需要在返回后，通过遍历pollfd来获取已经就绪的socket。事实上，同时连接的大量客户端在一时刻可能只有很少的处于就绪状态，因此随着监视的描述符数量的增长，其效率也会线性下降。

使用示例

```c
// 先宏定义长度
#define MAX_POLLFD_LEN 4096  

int main() {
  /*
   * 在这里进行一些初始化的操作，
   * 比如初始化数据和socket等。
   */

  int nfds = 0;
  pollfd fds[MAX_POLLFD_LEN];
  memset(fds, 0, sizeof(fds));
  fds[0].fd = listenfd;
  fds[0].events = POLLRDNORM;
  int max  = 0;  // 队列的实际长度，是一个随时更新的，也可以自定义其他的
  int timeout = 0;

  int current_size = max;
  while (1) {
    // 阻塞获取
    // 每次需要把fd从用户态拷贝到内核态
    nfds = poll(fds, max+1, timeout);
    if (fds[0].revents & POLLRDNORM) {
        // 这里处理accept事件
        connfd = accept(listenfd);
        //将新的描述符添加到读描述符集合中
    }
    // 每次需要遍历所有fd，判断有无读写事件发生
    for (int i = 1; i < max; ++i) {     
      if (fds[i].revents & POLLRDNORM) { 
         sockfd = fds[i].fd
         if ((n = read(sockfd, buf, MAXLINE)) <= 0) {
            // 这里处理read事件
            if (n == 0) {
                close(sockfd);
                fds[i].fd = -1;
            }
         } else {
             // 这里处理write事件     
         }
         if (--nfds <= 0) {
            break;       
         }   
      }
    }
  }
```

### epoll

epoll是在2.6内核中提出的，是之前的select和poll的增强版本。epoll使用一个文件描述符管理多个描述符，将用户关系的文件描述符的事件存放到内核的一个事件表中，这样在用户空间和内核空间的copy只需一次。还有一个特点是，epoll使用“事件”的就绪通知方式，通过epoll_ctl注册fd，一旦该fd就绪，内核就会采用类似callback的回调机制来激活该fd，epoll_wait便可以收到通知。

```c
#include <sys/epoll.h>
// 数据结构
// 每一个epoll对象都有一个独立的eventpoll结构体
// 用于存放通过epoll_ctl方法向epoll对象中添加进来的事件
// epoll_wait检查是否有事件发生时，只需要检查eventpoll对象中的rdlist双链表中是否有epitem元素即可
struct eventpoll {
    /*红黑树的根节点，这颗树中存储着所有添加到epoll中的需要监控的事件*/
    struct rb_root  rbr;
    /*双链表中则存放着将要通过epoll_wait返回给用户的满足条件的事件*/
    struct list_head rdlist;
};

//内核需要监视的事件
struct epoll_event {
  __uint32_t events;  /* Epoll events */
  epoll_data_t data;  /* User data variable */
};
//events可以是以下几个宏的集合：
//EPOLLIN ：表示对应的文件描述符可以读（包括对端SOCKET正常关闭）；
//EPOLLOUT：表示对应的文件描述符可以写；
//EPOLLPRI：表示对应的文件描述符有紧急的数据可读（这里应该表示有带外数据到来）；
//EPOLLERR：表示对应的文件描述符发生错误；
//EPOLLHUP：表示对应的文件描述符被挂断；
//EPOLLET： 将EPOLL设为边缘触发(Edge Triggered)模式，这是相对于水平触发(Level Triggered)来说的。
//EPOLLONESHOT：只监听一次事件，当监听完这次事件之后，如果还需要继续监听这个socket的话，需要再次把这个socket加入到EPOLL队列里

// API
int epoll_create(int size); // 内核中间加一个 ep 对象，把所有需要监听的 socket 都放到 ep 对象中
int epoll_ctl(int epfd, int op, int fd, struct epoll_event *event); // epoll_ctl 负责把 socket 增加、删除到内核红黑树
int epoll_wait(int epfd, struct epoll_event * events, int maxevents, int timeout);// epoll_wait 负责检测可读队列，没有可读 socket 则阻塞进程
```

相对于select和poll来说，epoll将I/O监视过程解耦为epoll_create、epoll_ctl和epoll_wait三个部分。用户可以使用epoll_ctl自由地向epoll对象添加和删除事件，这些事件被挂载到红黑树中（红黑树的时间效率是lg(n)），而所有添加到epoll中的事件都会与设备(网卡)驱动程序建立回调关系，当相应的事件发生时会调用事件绑定的回调方法，这个回调方法会将发生的事件添加到rdlist双链表中。epoll_wait负责等待事件的产生，实际上就是在这个rdlist链表中查看有没有就绪的fd，然后把就绪的事件反馈给用户。总结来说，通过红黑树和双链表数据结构，并结合回调机制，造就了epoll的高效。

epoll有EPOLLLT和EPOLLET两种触发模式，LT是默认的模式，ET是“高速”模式。
LT模式下，只要这个fd还有数据可读，每次 epoll_wait都会返回它的事件，提醒用户程序去操作。
ET模式下，它只会提示一次，直到下次再有数据流入之前都不会再提示了，无论fd中是否还有数据可读。所以在ET模式下，read一个fd的时候一定要把它的buffer读完，除非遇到EAGAIN错误。

epoll的优点：

- 没有最大并发连接的限制，能打开的FD的上限远大于1024（1G的内存上能监听约10万个端口，具体数目可以cat /proc/sys/fs/file-max察看）
- 效率提升，不是轮询的方式，不会随着FD数目的增加效率下降。只有活跃可用的FD才会调用callback函数；即Epoll最大的优点就在于它只管你“活跃”的连接，而跟连接总数无关，因此在实际的网络环境中，Epoll的效率就会远远高于select和poll
- 内存拷贝，利用mmap()文件映射内存加速与内核空间的消息传递，即epoll使用mmap减少复制开销

使用示例

```c
int main(int argc, char* argv[])
{
   /*
   * 在这里进行一些初始化的操作，
   * 比如初始化数据和socket等。
   */

    // 内核中创建ep对象
    epfd=epoll_create(256);
    // 需要监听的socket放到ep中
    epoll_ctl(epfd,EPOLL_CTL_ADD,listenfd,&ev);
 
    while(1) {
      // 阻塞获取
      nfds = epoll_wait(epfd,events,20,0);
      for(i=0;i<nfds;++i) {
          if(events[i].data.fd==listenfd) {
              // 这里处理accept事件
              connfd = accept(listenfd);
              // 接收新连接写到内核对象中
              epoll_ctl(epfd,EPOLL_CTL_ADD,connfd,&ev);
          } else if (events[i].events & EPOLLIN) {
              // 这里处理read事件
              read(sockfd, BUF, MAXLINE);
              //读完后准备写
              epoll_ctl(epfd,EPOLL_CTL_MOD,sockfd,&ev);
          } else if(events[i].events & EPOLLOUT) {
              // 这里处理write事件
              write(sockfd, BUF, n);
              //写完后准备读
              epoll_ctl(epfd,EPOLL_CTL_MOD,sockfd,&ev);
          }
      }
    }
    return 0;
}
```



### slect/poll/epoll之间的区别

![image-20210204171558596](assets/image-20210204171558596.png)

| 系统调用   | select             | poll             | epoll                                             |
| ---------- | ------------------ | ---------------- | ------------------------------------------------- |
| 数据结构   | 数组               | 链表             | 红黑树                                            |
| 最大连接数 | 1024               | 无上限           | 无上限                                            |
| fd拷贝     | 每次调用select拷贝 | 每次调用poll拷贝 | fd首次调用epoll_ctl拷贝，每次调用epoll_wait不拷贝 |
| 工作效率   | 轮询：O(n)         | 轮询：O(n)       | 回调：O(1)                                        |

综上，在选择select、poll、epoll时要根据具体的使用场合以及这三种方式的自身特点：

1. 表面上看epoll的性能最好，但是在连接数少并且连接都十分活跃的情况下，select和poll的性能可能比epoll好，毕竟epoll的通知机制需要很多函数回调。
2. select低效是因为每次它都需要轮询。但低效也是相对的，视情况而定，也可通过良好的设计改善。

## libevent源码剖析（v2.1.12-stable）

### Reactor事件处理机制

正常事件处理流程是应用程序调用某个接口触发某个功能，而Reactor模式需要我们将这些接口和宿主指针（谁调用这些接口）注册在Reactor，在合适的时机Reactor使用宿主指针调用注册好的回调函数，它具有如下优点：

- 响应快，不必为单个同步时间所阻塞，虽然 Reactor 本身依然是同步的；
- 编程相对简单，可以最大程度的避免复杂的多线程及同步问题，并且避免了多线程/
  进程的切换开销；
- 可扩展性，可以方便的通过增加 Reactor 实例个数来充分利用 CPU 资源；
- 可复用性， reactor 框架本身与具体事件处理逻辑无关，具有很高的复用性。

Reactor模式主要部件：

1. EventDemultiplexer 

事件多路分发机制，调用系统提供的I/O多路复用机制（select、epoll）。程序先将关注的句柄注册到 EventDemultiplexer 上，当有关注的事件到来时，触发 EventDemultiplexer 通知程序，调用之前注册好的回调函数完成消息相应。对应到 libevent 中，依然是 select、 poll、 epoll 等，但是 libevent 使用结构体eventop进行了封装（位于poll.c/select.c/kqueue.c/devpoll.c中），以统一的接口（init、add、del、dispatch、dealloc函数指针）来支持这些 I/O 多路复用机制，达到了对外隐藏底层系统机制的目的。C++语言提供了虚函数来实现多态，在C语言中，这是通过函数指针实现的。

Libevent把所有支持的I/O demultiplex机制存储在一个全局静态数组eventops中，并根据系统配置和编译选项决定使用哪一种I/O demultiplex机制，即libevent在编译阶段选择系统的I/O demultiplex机制，而不支持在运行阶段根据配置再次选择。以epoll为例，eventops对象epollops定义如下：

```c
const struct eventop epollops = {
	"epoll",
	epoll_init,
	epoll_nochangelist_add,
	epoll_nochangelist_del,
	epoll_dispatch,
	epoll_dealloc,
	1, /* need reinit */
	EV_FEATURE_ET|EV_FEATURE_O1|EV_FEATURE_EARLY_CLOSE,
	0
};
```

libevent调用结构体eventop的init和dispatch函数指针时，实际调用的函数就是epoll的初始化函数epoll_init()和事件分发函数epoll_dispatch()。

2. Reactor

事件管理的接口，内部使用 EventDemultiplexer 注册、注销事件；根据系统提供的事件多路分发机制执行事件循环，当有事件进入“就绪”状态时，调用注册事件的回调函数处理事件。对应到 libevent 中，就是 event_base 结构体（位于event-internal.h中）和事件注册、注销等接口函数。

```c
int  event_add(struct event *ev, const struct timeval *timeout);
int  event_del(struct event *ev);
int  event_base_loop(struct event_base *base, int loops);
void event_active(struct event *event, int res, short events);
void event_process_active(struct event_base *base);
```

创建了一个新的libevent实例时，程序需要通过调用event_base_new函数来创建创建一个event_base对象，该函数同时还对新生成的libevent实例进行了初始化，首先为event_base实例申请空间，然后初始化timeheap，选择合适的系统I/O的demultiplexer机制初始化各事件链表；函数还检测了系统的时间设置，为后面的时间管理打下基础。注册和删除事件的流程类似（event.c中的event_add_nolock_、event_del_nolock_）。

在event_base_loop中，libevent根据系统提供的事件多路分发机制执行事件主循环。流程如下：

- 首先判断退出循环的标记是否置位(event_gotterm和event_break),如果置位,直接退出循环
- 校正系统时间(将tv赋值)
- 根据最小超时时间,计算最近的等待时间,如果有未处理的激活事件或者设置了非阻塞标志,则无需等待(定时时间设为0)
- 如果没有注册事件,则退出;否则调用多路I/O机制的等待函数
- 之后便检测小根堆中是否有超时事件,如果有,将其从小根堆移入激活事件链表中
- 接下来,如果有激活事件,则进行处理。并且如果要求执行到当前激活链表中没有事件可以执行就退出或者设置的是非阻塞,则下次就退出循环。

Libevent将Timer和Signal事件都统一到了系统的I/O 的demultiplex机制中。

系统的I/O机制像select()和epoll_wait()都允许程序制定一个最大等待时间（也称为最大超时时间）timeout，即使没有I/O事件发生，它们也保证能在timeout时间内返回。那么根据所有Timer事件的最小超时时间来设置系统I/O的timeout时间；当系统I/O返回时，再激活所有就绪的Timer事件就可以了，这样就能将Timer事件完美的融合到系统的I/O机制中了。libevent采用堆结构（插入、删除元素时间复杂度都是O(lgN)，而获取最小key值（小根堆）的复杂度为O(1)）来管理Timer事件。

Signal是异步事件的经典事例，将Signal事件统一到系统的I/O多路复用中就不像Timer事件那么自然了，Signal事件的出现对于进程来讲是完全随机的，进程不能只是测试一个变量来判别是否发生了一个信号，而是必须告诉内核“在此信号发生时，请执行如下的操作”。当Signal发生时，libevent并不立即调用event的callback函数处理信号，而是设法通知系统的I/O机制（为socket pair的读socket在libevent的event_base实例上注册一个persist的读事件），让其返回，然后再统一和I/O事件以及Timer一起处理。

3.  EventHandler

事件处理程序，提供了一组接口，每个接口对应了一种类型的事件，供 Reactor 在相应的事件发生时调用，执行相应的事件处理。通常它会绑定一个有效的句柄。对应到 libevent 中，就是 event 结构体（位于event-struct.h中）。

每次当有事件event转变为就绪状态时，libevent就会把它移入到ev_evcallback中，其中ev_evcallback->priority是event的优先级；接着libevent会根据自己的调度策略（event.c中event_base_loop>>event_process_active>>event_process_active_single_queue）选择就绪事件，调用ev_evcallback->evcb_callback()函数执行事件处理。

### 使用示例

```c
/*
    这是一个示例性质的libevent的程序，监听在TCP的9995端口。
    当连接建立成功后，它将会给Client回应一个消息"Hello, World!\n"
    发送完毕后就将连接关闭。

    程序也处理了SIGINT (ctrl-c)信号，收到这个信号后优雅退出程序。

    这个程序也用到了一些libevent比较高级的API：“bufferevent”
    这套API将buffer的“水位线”也抽象成了event来处理，灵感应该是来自
    Windows平台的IOCP。
*/

// 引入常用Linux系统头文件 
#include <string.h>
#include <errno.h>
#include <stdio.h>
#include <signal.h>
#include <netinet/in.h>
#include <arpa/inet.h>
#include <sys/socket.h>

// 引入libevent 2.x相关的头文件 
#include <event2/bufferevent.h>
#include <event2/buffer.h>
#include <event2/listener.h>
#include <event2/util.h>
#include <event2/event.h>

// 定义字符串常量，将会回应给Client用 
static const char MESSAGE[] = "Hello, World!\n";

// server监听的端口 
static const int PORT = 9995;

// 定义几个event callback的prototype（原型） 
static void listener_cb(struct evconnlistener * , evutil_socket_t,
    struct sockaddr * , int socklen, void * );
static void conn_writecb(struct bufferevent * , void * );
static void conn_eventcb(struct bufferevent * , short, void * );
static void signal_cb(evutil_socket_t, short, void * );

// 定义标准的main函数 
int
main(int argc, char ** argv)
{
    // event_base是整个event循环必要的结构体 
    struct event_base * base;
    // libevent的高级API专为监听的FD使用 
    struct evconnlistener * listener;
    // 信号处理event指针 
    struct event * signal_event;
    // 保存监听地址和端口的结构体 
    struct sockaddr_in sin;

    // 分配并初始化event_base 
    base = event_base_new();
    if (!base) {
        // 如果发生任何错误，向stderr（标准错误输出）打一条日志，退出 
        // 在C语言里，很多返回指针的API都以返回null为出错的返回值 
        // if (!base) 等价于 if (base == null) 
        fprintf(stderr, "Could not initialize libevent!\n");
        return 1;
    }

    // 初始化sockaddr_in结构体，监听在0.0.0.0:9995 
    memset(&sin, 0, sizeof(sin));
    sin.sin_family = AF_INET;
    sin.sin_port = htons(PORT);

    // bind在上面制定的IP和端口，同时初始化listen的事件循环和callback：listener_cb 
    // 并把listener的事件循环注册在event_base：base上 
    listener = evconnlistener_new_bind(base, listener_cb, (void * )base,
        LEV_OPT_REUSEABLE|LEV_OPT_CLOSE_ON_FREE, -1,
        (struct sockaddr*)&sin,
        sizeof(sin));

    if (!listener) {
        // 如果发生任何错误，向stderr（标准错误输出）打一条日志，退出 
        fprintf(stderr, "Could not create a listener!\n");
        return 1;
    }

    // 初始化信号处理event 
    signal_event = evsignal_new(base, SIGINT, signal_cb, (void * )base);

    // 把这个callback放入base中 
    if (!signal_event || event_add(signal_event, NULL)<0) {
        fprintf(stderr, "Could not create/add a signal event!\n");
        return 1;
    }

    // 程序将在下面这一行内启动event循环，只有在调用event_base_loopexit后 
    // 才会从下面这个函数返回，并向下执行各种清理函数，导致整个程序退出 
    event_base_dispatch(base);

    // 各种清理free 
    evconnlistener_free(listener);
    event_free(signal_event);
    event_base_free(base);

    printf("done\n");
    return 0;
}

// 监听端口的event callback 
static void
listener_cb(struct evconnlistener * listener, evutil_socket_t fd,
    struct sockaddr * sa, int socklen, void * user_data)
{
    struct event_base * base = user_data;
    struct bufferevent * bev;

    // 新建一个bufferevent，设定BEV_OPT_CLOSE_ON_FREE， 
    // 保证bufferevent被free的时候fd也会被关闭 
    bev = bufferevent_socket_new(base, fd, BEV_OPT_CLOSE_ON_FREE);
    if (!bev) {
        fprintf(stderr, "Error constructing bufferevent!");
        event_base_loopbreak(base);
        return;
    }
    // 设定写buffer的event和其它event 
    bufferevent_setcb(bev, NULL, conn_writecb, conn_eventcb, NULL);
    // 开启向fd中写的event 
    bufferevent_enable(bev, EV_WRITE);
    // 关闭从fd中读写入buffer的event 
    bufferevent_disable(bev, EV_READ);
    // 向buffer中写入"Hello, World!\n" 
    // 上面的操作保证在fd可写时，将buffer中的内容写出去 
    bufferevent_write(bev, MESSAGE, strlen(MESSAGE));
}


// 每次fd可写，数据非阻塞写入后，会调用conn_writecb 
// 这个函数每次检查eventbuffer的剩余大小，如果为0表示数据已经全部写完，将eventbuffer free掉 
// 由于在上面设定了BEV_OPT_CLOSE_ON_FREE，所以fd也会被关闭 
static void
conn_writecb(struct bufferevent * bev, void * user_data)
{
    struct evbuffer * output = bufferevent_get_output(bev);
    if (evbuffer_get_length(output) == 0) {
        printf("flushed answer\n");
        bufferevent_free(bev);
    }
}

// 处理读、写event之外的event的callback 
static void
conn_eventcb(struct bufferevent * bev, short events, void * user_data)
{
    if (events & BEV_EVENT_EOF) {
        // Client端关闭连接 
        printf("Connection closed.\n");
    } else if (events & BEV_EVENT_ERROR) {
        // 连接出错 
        printf("Got an error on the connection: %s\n",
            strerror(errno));
    }
    // 如果还有其它的event没有处理，那就关闭这个bufferevent 
    bufferevent_free(bev);
}

// 信号处理event，收到SIGINT (ctrl-c)信号后，延迟2s退出event循环 
static void
signal_cb(evutil_socket_t sig, short events, void * user_data)
{
    struct event_base * base = user_data;
    struct timeval delay = { 2, 0 };

    printf("Caught an interrupt signal; exiting cleanly in two seconds.\n");

    event_base_loopexit(base, &delay);
}
```

### Libevent支持多线程

Libevent本身不是多线程安全的，因此不能直接将event_base_dispatch、event_add等粗暴的使用多线程拆分。合适的做法是实例化多个libevent，每个线程都是一个单独的libevent实例。[memcached](http://memcached.org/)的多线程模型即使用此种机制，并且采用队列和消息通知机制处理各个连接。
![image-20210209113435980](assets/image-20210209113435980.png)

## muduo源码剖析

TCP网络编程的实质是处理连接的建立（socket、bind、list、accept）、消息到达（recv）、消息发送完毕（send）、连接的断开(close)这几个事件。muduo针对这几个事件抽象出了EventLoop、Acceptor/Connector、Tcpconnection、Channel核心类。

![image-20210219140829291](assets/image-20210219140829291.png)

EventLoop负责接收外界的请求，把成功建立的连接（TcpConnection）分配到EventLoopThreadPool中具体的EventLoop中（图中的EventLoop1、EventLoop2、EventLoop3等）。EventLoop总体负责绑定和监听端口，EventLoop调用Acceptor中函数完成bind、listen、accept操作。epoll模型的操作也被封装在了EventLoop中，EventLoop中loop方法中完成对epoll模型的调度。epoll对读写事件的操作封装在了Channel类中。accept描述符注册到epoll中是通过Channel中的enableReading进行的。
![image-20210219141520075](assets/image-20210219141520075.png)

1. TcpServer类提供了两个可供外界实现的回调函数接口：ConnectionCallback和MessageCallback。在TcpServer的构造函数中初始化了Acceptor和EventLoopThreadPool。Acceptor中创建了socket同时进行了bind；将socket放在了acceptChannel中，在acceptChannel中注册了Acceptor::handleRead函数；绑定了TcpServer::newConnection函数。

2. TcpServer通过start函数调用了EventLoop的runLoop方法。runLoop中执行了Acceptor::listen函数，在此函数中完成了socket的listen操作和注册到epoll模型的操作。
3. 当有客户端连接请求时会触发epoll模型，把accept成功的socket放到了TcpConnection中，并按照轮询方式把TcpConnection的socket注册到不同的EventLoop中。当有客户端发起链接时，触发acceptChannel_中注册的Acceptor::handleRead函数，而Acceptor::handleRead中继续调用了Acceptor中注册的TcpServer::newConnection。在TcpServer::newConnection中，进行了socket的accept操作，并生成了新的TcpConnection。后续在runInLoop中调用了TcpConnection::connectEstablished方法，将socket注册到EventLoopThreadPool中的EventLoop中，并调用了在TcpServer中注册的ConnectionCallback函数。
4. epoll模型开始等待外界发送请求，这时会触发channel_的handRead方法，在handRead中读取了请求，然后调用了TcpServer中注册的messageCallback_方法，也就是业务逻辑的主要实现函数。messageCallback_方法中不仅包含处理请求的逻辑，还必须考虑怎样返回结果，其中一种可选方式是调用TcpConnection的send方法发送结果。

muduo 默认也是单线程模型的，即只有一个线程，里面对应一个 EventLoop。多线程模型的介绍可以参考[这篇文章](https://www.cyhone.com/articles/analysis-of-muduo/)。

## 协程

综合上文所述，早期解决C10K问题的办法是依赖于操作系统提供的I/O复用操作，也就是 epoll/IOCP 多路复用加线程池技术来实现的。本质上这类程序会维护一个复杂的状态机，采用异步的方式编码（消息机制或者是回调函数）。很多用 C/C++ 实现的框架都是这个套路，缺点在于这样的代码一般比较复杂，特别是异步编码加状态机的模式对于程序员是一个很大的挑战。但是从另外一个角度看，符合人类逻辑思维的操作方式却恰恰是同步的。

在Python等程序语言中，协程的引入可以用来替代回调以简化问题，即以近似同步代码的编程模式实现异步回调机制，在形式上和真实业务同步线性的推演逻辑保持一致。协程可以直接利用代码的执行位置来表示状态，而回调则是携带了一堆数据结构来处理状态或管理上下文。在典型的服务场景中：任务A被拆分为任务B和任务C，如果B和C执行时间不确定（比如要查数据库），那么为了充分提升效率很有必要做成异步机制。如果回调层次比较深、回调次数比较多，就得一直带着一大串额外的回调信息。这时候不得不承认，协程的封装显得非常有必要，这种设计可以避免把共享的状态接力似的传递给每一个回调（在非OOP编程风格的场景下表现得尤为突出）。

以下载10篇网页的爬虫代码为例：

```python
#回调写法
#!/usr/bin/env python
# encoding: utf-8

import socket
from selectors import DefaultSelector, EVENT_WRITE, EVENT_READ

selector = DefaultSelector()
stopped = False
urls_todo = {'/', '/1', '/2', '/3', '/4', '/5', '/6', '/7', '/8', '/9'}


class Crawler:
    def __init__(self, url):
        self.url = url
        self.sock = None
        self.response = b''

    def fetch(self):
        self.sock = socket.socket()
        self.sock.setblocking(False)
        try:
            self.sock.connect(('example.com', 80))
        except BlockingIOError:
            pass
        selector.register(self.sock.fileno(), EVENT_WRITE, self.connected)

    def connected(self, key, mask):
        selector.unregister(key.fd)
        get = 'GET {0} HTTP/1.0\r\nHost: example.com\r\n\r\n'.format(self.url)
        self.sock.send(get.encode('ascii'))
        selector.register(key.fd, EVENT_READ, self.read_response)

    def read_response(self, key, mask):
        global stopped
        # 如果响应大于4KB，下一次循环会继续读
        chunk = self.sock.recv(4096)
        if chunk:
            self.response += chunk
        else:
            selector.unregister(key.fd)
            urls_todo.remove(self.url)
            if not urls_todo:
                stopped = True


def loop():
    while not stopped:
        # 阻塞, 直到一个事件发生
        events = selector.select()
        for event_key, event_mask in events:
            callback = event_key.data
            callback(event_key, event_mask)


if __name__ == '__main__':
    import time
    start = time.time()
    for url in urls_todo:
        crawler = Crawler(url)
        crawler.fetch()
    loop()
    print(time.time() - start)
```

```python
#协程写法
#!/usr/bin/env python
# encoding: utf-8

import socket
from selectors import DefaultSelector, EVENT_WRITE, EVENT_READ

selector = DefaultSelector()
stopped = False
urls_todo = {'/', '/1', '/2', '/3', '/4', '/5', '/6', '/7', '/8', '/9'}


def connect(sock, address):
    f = Future()
    sock.setblocking(False)
    try:
        sock.connect(address)
    except BlockingIOError:
        pass

    def on_connected():
        f.set_result(None)

    selector.register(sock.fileno(), EVENT_WRITE, on_connected)
    yield from f
    selector.unregister(sock.fileno())


def read(sock):
    f = Future()

    def on_readable():
        f.set_result(sock.recv(4096))

    selector.register(sock.fileno(), EVENT_READ, on_readable)
    chunk = yield from f
    selector.unregister(sock.fileno())
    return chunk


def read_all(sock):
    response = []
    chunk = yield from read(sock)
    while chunk:
        response.append(chunk)
        chunk = yield from read(sock)
    return b''.join(response)


class Future:
    def __init__(self):
        self.result = None
        self._callbacks = []

    def add_done_callback(self, fn):
        self._callbacks.append(fn)

    def set_result(self, result):
        self.result = result
        for fn in self._callbacks:
            fn(self)

    def __iter__(self):
        yield self
        return self.result


class Crawler:
    def __init__(self, url):
        self.url = url
        self.response = b''

    def fetch(self):
        global stopped
        sock = socket.socket()
        yield from connect(sock, ('example.com', 80))
        get = 'GET {0} HTTP/1.0\r\nHost: example.com\r\n\r\n'.format(self.url)
        sock.send(get.encode('ascii'))
        self.response = yield from read_all(sock)
        urls_todo.remove(self.url)
        if not urls_todo:
            stopped = True


class Task:
    def __init__(self, coro):
        self.coro = coro
        f = Future()
        f.set_result(None)
        self.step(f)

    def step(self, future):
        try:
            # send会进入到coro执行, 即fetch, 直到下次yield
            # next_future 为yield返回的对象
            next_future = self.coro.send(future.result)
        except StopIteration:
            return
        next_future.add_done_callback(self.step)


def loop():
    while not stopped:
        # 阻塞, 直到一个事件发生
        events = selector.select()
        for event_key, event_mask in events:
            callback = event_key.data
            callback()


if __name__ == '__main__':
    import time
    start = time.time()
    for url in urls_todo:
        crawler = Crawler(url)
        Task(crawler.fetch())
    loop()
    print(time.time() - start)
```

协程在实践中的实现方式千差万别，一个简单的原因，是协程本身可以通过许多基本元素构建。基本元素的选取方式不一样，构建出来的协程抽象也就有差别。比如, Lua 语言选取了 create, resume 和 yield 作为基本构建元素, 从调度器层面构建出所谓的“非对程”协程系统。而 Julia 语言绕过调度器，通过在协程内调用 yieldto 函数完成了同样的功能，构建出了一个所谓的对称协程系统。尽管这两个语言使用了同样的 setjmp 库，构造出来的原语却不一样。又比如，许多 C 语言的协程库都使用了 ucontext 库实现，这是因为 POSIX 本身提供了 ucontext 库，不少协程实现是以 ucontext 为蓝本实现的。这些实现，都不可避免地带上了 ucontext 系统的一些基本假设，比如协程间是平等的，一般带有调度器来协调协程等等（比如 libtask 实现，以及 云风的 coroutine 库 ）。Go 语言的一个鲜明特色就是通道（channel）作为一级对象。因此，resume 和 yield 等在其他语言里的原语在 go 里都以通道方式构建。我们还可以举出许多同样的例子。这些风格的差异往往和语言的历史、演化路径和要解决的问题相关，我们不必苛求他们的协程模型一定要如此这般。

总的来说，协程为协同任务提供了一种运行时抽象。这种抽象非常适合于协同多任务调度和数据流处理。在现代操作系统和编程语言中，因为用户态线程切换代价比内核态线程小，协程成为了一种轻量级的多任务模型。我们无法预测未来，但是可以看到，协程已经成为许多擅长数据处理的语言的一级对象。随着计算机并行性能的提升，用户态任务调度已经成为一种标准的多任务模型。在这样的大趋势下，协程这个简单且有效的模型就显得更加引人注目。

在性能层面上，协程是一种轻量级的线程，本质上协程就是用户空间下的线程（和线程一样，本质上都是控制流的主动让出和恢复机制），如果把线程/进程当作虚拟“CPU”，协程即跑在这个“CPU”上的线程。协程的开销成本很低，每一个协程仅有一个轻巧的用户态栈空间，因此可以方便的处理并发行为。基于是否使用栈和上下文切换机制，协程的具体实现又可以分为有栈和无栈，这里不展开探讨。

## 参考

1. [Linux IO模式及 select、poll、epoll详解](https://segmentfault.com/a/1190000003063859)

2. [libevent源码深度剖析-张亮](https://blog.csdn.net/xp178171640/article/details/105490027)

3. 《Linux多线程服务端编程：使用muduo C++网络库》
4. [编程珠玑番外篇-Q 协程的历史，现在和未来](https://www.tuicool.com/articles/BNvUfeb)

5. [并发之痛 Thread，Goroutine，Actor](http://jolestar.com/parallel-programming-model-thread-goroutine-actor/)

6. [深入理解 Python 异步编程（上）](https://mp.weixin.qq.com/s?__biz=MzIxMjY5NTE0MA==&mid=2247483720&idx=1&sn=f016c06ddd17765fd50b705fed64429c)